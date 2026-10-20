import fs from "fs";
import https from "https";
import { prisma } from "../db";
import { config } from "../config";
import { decrypt } from "../lib/certificate";
import { emitToPortal } from "../realtime";
import {
  AeatEnvironment,
  buildEnvelope,
  CertificateKind,
  DEFAULT_WAIT_SECONDS,
  endpointFor,
  MAX_RECORDS_PER_SUBMISSION,
  parseResponse,
  SoapFaultError,
  toAeatDate,
} from "./soap";

const RETRY_AFTER_ERROR_SECONDS = 120;

function post(url: string, body: string, pfx: Buffer, passphrase: string): Promise<string> {
  const ca = config.aeatExtraCaFile ? [fs.readFileSync(config.aeatExtraCaFile)] : undefined;
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        pfx,
        passphrase,
        ...(ca ? { ca } : {}),
        headers: { "Content-Type": "text/xml; charset=UTF-8", "Content-Length": Buffer.byteLength(body) },
        timeout: 60_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          // Los SOAP Fault llegan con HTTP 500 y cuerpo XML: los interpreta parseResponse
          if (res.statusCode === 200 || text.includes("Fault")) resolve(text);
          else reject(new Error(`La AEAT respondió HTTP ${res.statusCode}`));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("La AEAT no respondió a tiempo")));
    req.on("error", (e) => reject(new Error(`No se pudo conectar con la AEAT: ${e.message}`)));
    req.end(body);
  });
}

function addSeconds(d: Date, seconds: number) {
  return new Date(d.getTime() + seconds * 1000);
}

/**
 * Envía los registros pendientes de un restaurante si le toca: ha pasado el
 * tiempo de espera indicado por la AEAT o se han acumulado 1.000 registros.
 */
export async function sendPendingForTenant(tenantId: string, now = new Date()) {
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  if (!settings) return;

  const pendingCount = await prisma.invoice.count({ where: { tenantId, aeatStatus: "PENDING" } });
  if (!pendingCount) return;
  if (settings.aeatNextSendAt && now < settings.aeatNextSendAt && pendingCount < MAX_RECORDS_PER_SUBMISSION) return;

  if (!settings.certificatePfx || !settings.certificatePassword) {
    await prisma.tenantSettings.update({
      where: { tenantId },
      data: { aeatLastError: "Falta el certificado electrónico para enviar a la AEAT: súbelo en Ajustes" },
    });
    return;
  }

  // Un envío = un obligado (NIF) y un entorno. Orden de la cadena de cada TPV.
  const oldest = await prisma.invoice.findFirstOrThrow({
    where: { tenantId, aeatStatus: "PENDING" },
    orderBy: [{ issuedAt: "asc" }, { chainSeq: "asc" }],
  });
  const environment = oldest.environment as AeatEnvironment;
  const batch = await prisma.invoice.findMany({
    where: { tenantId, aeatStatus: "PENDING", environment, issuerNif: oldest.issuerNif },
    orderBy: [{ deviceId: "asc" }, { chainSeq: "asc" }],
    take: MAX_RECORDS_PER_SUBMISSION,
  });

  const envelope = buildEnvelope({
    issuerName: settings.legalName,
    issuerNif: oldest.issuerNif!,
    endDate: settings.verifactuEndDate ? toAeatDate(settings.verifactuEndDate.toISOString()) : null,
    records: batch.map((i) => i.recordXml!),
  });
  const url = config.aeatEndpointOverride ?? endpointFor(environment, settings.certificateKind as CertificateKind);

  let responseXml: string | null = null;
  try {
    const pfx = decrypt(Buffer.from(settings.certificatePfx));
    const passphrase = decrypt(Buffer.from(settings.certificatePassword)).toString("utf8");
    responseXml = await post(url, envelope, pfx, passphrase);
    const response = parseResponse(responseXml);

    const byNumSerie = new Map(response.lines.map((l) => [l.numSerie, l]));
    await prisma.$transaction(async (tx) => {
      const submission = await tx.aeatSubmission.create({
        data: {
          tenantId,
          environment,
          status: response.status,
          csv: response.csv,
          waitSeconds: response.waitSeconds,
          records: batch.length,
          responseXml,
        },
      });
      for (const invoice of batch) {
        const line = byNumSerie.get(invoice.numSerie);
        if (!line) continue;
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            aeatStatus: line.status,
            aeatErrorCode: line.errorCode,
            aeatError: line.error,
            aeatSentAt: now,
            submissionId: submission.id,
          },
        });
      }
      await tx.tenantSettings.update({
        where: { tenantId },
        data: {
          aeatNextSendAt: addSeconds(now, response.waitSeconds),
          aeatLastError: null,
          ...(environment === "PRODUCTION" && !settings.verifactuFirstSentAt ? { verifactuFirstSentAt: now } : {}),
        },
      });
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.aeatSubmission.create({
      data: { tenantId, environment, status: "ERROR", records: batch.length, error, responseXml },
    });
    await prisma.tenantSettings.update({
      where: { tenantId },
      data: {
        aeatLastError: error,
        aeatNextSendAt: addSeconds(now, e instanceof SoapFaultError ? DEFAULT_WAIT_SECONDS : RETRY_AFTER_ERROR_SECONDS),
      },
    });
  }
  emitToPortal(tenantId, "verifactu:updated");
}

let running = false;

export async function runAeatSender() {
  if (running) return;
  running = true;
  try {
    const tenants = await prisma.invoice.groupBy({ by: ["tenantId"], where: { aeatStatus: "PENDING" } });
    for (const { tenantId } of tenants) {
      await sendPendingForTenant(tenantId).catch((e) => console.error("[aeat]", tenantId, e));
    }
  } finally {
    running = false;
  }
}

export function startAeatSender(intervalMs = 10_000) {
  return setInterval(() => void runAeatSender(), intervalMs);
}
