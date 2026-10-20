import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { config } from "../config";
import { requirePortal } from "../auth";
import { h, HttpError } from "../lib/http";
import { bumpConfig, getTenantSettings, ticketDesign } from "../lib/configSync";
import { sanitizeLogo } from "../lib/ticketLogo";
import { encrypt, inspectPfx } from "../lib/certificate";
import { isValidNif, normalizeNif } from "../lib/nif";
import { emitToPortal, requestFromDevices } from "../realtime";

export const settingsRouter = Router();
settingsRouter.use(requirePortal);

type Settings = Awaited<ReturnType<typeof getTenantSettings>>;

function endOfYear(d: Date) {
  return new Date(Date.UTC(d.getFullYear(), 11, 31));
}

/** Lo que falta para poder activar VERI*FACTU. */
function verifactuMissing(s: Settings) {
  const missing: string[] = [];
  if (!s.legalName) missing.push("Razón social");
  if (!s.nif) missing.push("NIF");
  if (!s.certificatePfx) missing.push("Certificado electrónico");
  else if (s.certificateNotAfter && s.certificateNotAfter < new Date()) missing.push("Certificado electrónico vigente (el actual ha caducado)");
  if (!config.sif) missing.push("Datos del productor del software en el servidor (SIF_PRODUCER_NAME y SIF_PRODUCER_NIF)");
  return missing;
}

/** Los ajustes se crean al primer uso: actualizar sin que existan no debe fallar. */
async function updateSettings(tenantId: string, data: Prisma.TenantSettingsUncheckedUpdateInput) {
  await getTenantSettings(tenantId);
  await prisma.tenantSettings.update({ where: { tenantId }, data });
}

async function view(tenantId: string) {
  const s = await getTenantSettings(tenantId);
  const [pending, rejected] = await Promise.all([
    prisma.invoice.count({ where: { tenantId, aeatStatus: "PENDING" } }),
    prisma.invoice.count({ where: { tenantId, aeatStatus: "REJECTED" } }),
  ]);
  return {
    business: {
      tradeName: s.tradeName,
      legalName: s.legalName,
      nif: s.nif,
      address: s.address,
      receiptPrinterId: s.receiptPrinterId,
    },
    ticket: (() => {
      const design = ticketDesign(s);
      return {
        ...design,
        // Se eligen antes de subir el logo: van siempre, haya logo o no
        logoSize: s.ticketLogoSize,
        logoStyle: s.ticketLogoStyle,
        logo: design.logo && { ...design.logo, dataUrl: `data:image/png;base64,${Buffer.from(s.ticketLogo!).toString("base64")}` },
      };
    })(),
    verifactu: {
      enabled: s.verifactuEnabled,
      environment: s.verifactuEnvironment,
      endDate: s.verifactuEndDate?.toISOString().slice(0, 10) ?? null,
      firstSentAt: s.verifactuFirstSentAt,
      certificateKind: s.certificateKind,
      certificate: s.certificatePfx ? { subject: s.certificateSubject, notAfter: s.certificateNotAfter } : null,
      missing: verifactuMissing(s),
      lastError: s.aeatLastError,
      nextSendAt: s.aeatNextSendAt,
      pending,
      rejected,
    },
    onlinePayments: { enabled: s.onlinePaymentsEnabled, available: !!config.paymentProvider, provider: config.paymentProvider },
    email: { configured: !!config.smtp },
  };
}

settingsRouter.get(
  "/settings",
  h(async (req, res) => {
    res.json(await view(req.tenantId!));
  }),
);

const businessSchema = z.object({
  tradeName: z.string().trim().max(120).default(""),
  legalName: z.string().trim().max(120),
  nif: z.string().trim().max(20),
  address: z.string().trim().max(200).default(""),
  receiptPrinterId: z.string().uuid().nullable().default(null),
});

settingsRouter.put(
  "/settings/business",
  h(async (req, res) => {
    const data = businessSchema.parse(req.body);
    const nif = data.nif ? normalizeNif(data.nif) : "";
    if (nif && !isValidNif(nif)) throw new HttpError(400, "El NIF no es válido (revisa la letra o el dígito de control)");
    if (data.receiptPrinterId && !(await prisma.printer.count({ where: { id: data.receiptPrinterId, tenantId: req.tenantId! } }))) {
      throw new HttpError(400, "Impresora no válida");
    }
    const current = await getTenantSettings(req.tenantId!);
    // Con VERI*FACTU activo los registros llevan el NIF y la razón social: no
    // se pueden dejar vacíos.
    if (current.verifactuEnabled && (!nif || !data.legalName)) {
      throw new HttpError(409, "Con VERI*FACTU activado el NIF y la razón social son obligatorios");
    }
    await updateSettings(req.tenantId!, { ...data, nif });
    await bumpConfig(req.tenantId!);
    res.json(await view(req.tenantId!));
  }),
);

const verifactuSchema = z.object({
  enabled: z.boolean(),
  environment: z.enum(["TEST", "PRODUCTION"]),
  certificateKind: z.enum(["PERSONAL", "SELLO"]).default("PERSONAL"),
});

settingsRouter.put(
  "/settings/verifactu",
  h(async (req, res) => {
    const data = verifactuSchema.parse(req.body);
    const s = await getTenantSettings(req.tenantId!);
    const sentInProduction = !!s.verifactuFirstSentAt;

    if (data.environment === "TEST" && s.verifactuEnvironment === "PRODUCTION" && sentInProduction) {
      throw new HttpError(409, "Ya se han enviado registros a la AEAT en producción: no se puede volver al entorno de pruebas");
    }

    let update: Partial<Settings>;
    let message: string | null = null;
    if (data.enabled) {
      const missing = verifactuMissing(s);
      if (missing.length) throw new HttpError(409, `Para activar VERI*FACTU falta: ${missing.join(", ")}`);
      update = { verifactuEnabled: true, verifactuEndDate: null };
    } else if (s.verifactuEnabled && s.verifactuEnvironment === "PRODUCTION" && sentInProduction) {
      // Tras el primer envío efectivo hay que seguir hasta el 31 de diciembre;
      // la fecha de fin se comunica a la AEAT en los siguientes envíos.
      const end = endOfYear(new Date());
      update = { verifactuEnabled: true, verifactuEndDate: end };
      message = `VERI*FACTU seguirá activo hasta el ${end.toLocaleDateString("es-ES", { timeZone: "UTC" })}: la normativa obliga a mantenerlo hasta final del año natural.`;
    } else {
      update = { verifactuEnabled: false, verifactuEndDate: null };
    }

    await updateSettings(req.tenantId!, {
      ...update,
      verifactuEnvironment: data.environment,
      certificateKind: data.certificateKind,
    });
    await bumpConfig(req.tenantId!);
    emitToPortal(req.tenantId!, "verifactu:updated");
    res.json({ ...(await view(req.tenantId!)), message });
  }),
);

const certificateSchema = z.object({
  pfxBase64: z.string().min(100).max(200_000),
  password: z.string().min(1).max(200),
});

settingsRouter.put(
  "/settings/certificate",
  h(async (req, res) => {
    const { pfxBase64, password } = certificateSchema.parse(req.body);
    const pfx = Buffer.from(pfxBase64, "base64");
    const info = inspectPfx(pfx, password);
    await updateSettings(req.tenantId!, {
      certificatePfx: encrypt(pfx),
      certificatePassword: encrypt(Buffer.from(password, "utf8")),
      certificateSubject: info.subject,
      certificateNotAfter: info.notAfter,
      aeatLastError: null,
    });
    emitToPortal(req.tenantId!, "verifactu:updated");
    res.json(await view(req.tenantId!));
  }),
);

settingsRouter.delete(
  "/settings/certificate",
  h(async (req, res) => {
    const s = await getTenantSettings(req.tenantId!);
    if (s.verifactuEnabled) throw new HttpError(409, "Desactiva VERI*FACTU antes de borrar el certificado");
    await updateSettings(req.tenantId!, {
      certificatePfx: null,
      certificatePassword: null,
      certificateSubject: null,
      certificateNotAfter: null,
    });
    res.json(await view(req.tenantId!));
  }),
);

// ---------- Diseño del ticket ----------

const multiline = (max: number, lines: number) =>
  z
    .string()
    .max(max)
    .transform((v) =>
      v
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n"),
    )
    .refine((v) => v.split("\n").length <= lines, `Como mucho ${lines} líneas`);

const ticketSchema = z.object({
  showTradeName: z.boolean(),
  headerText: multiline(200, 4),
  footer: multiline(200, 4),
  showTable: z.boolean(),
  showWaiter: z.boolean(),
  logoSize: z.number().int().min(20).max(100),
  logoStyle: z.enum(["DITHER", "THRESHOLD"]),
});

settingsRouter.put(
  "/settings/ticket",
  h(async (req, res) => {
    const d = ticketSchema.parse(req.body);
    await updateSettings(req.tenantId!, {
      ticketShowTradeName: d.showTradeName,
      ticketHeaderText: d.headerText,
      ticketFooter: d.footer,
      ticketShowTable: d.showTable,
      ticketShowWaiter: d.showWaiter,
      ticketLogoSize: d.logoSize,
      ticketLogoStyle: d.logoStyle,
    });
    await bumpConfig(req.tenantId!);
    res.json(await view(req.tenantId!));
  }),
);

settingsRouter.put(
  "/settings/ticket/logo",
  h(async (req, res) => {
    const { pngBase64 } = z.object({ pngBase64: z.string().min(1).max(1_500_000) }).parse(req.body);
    const logo = sanitizeLogo(Buffer.from(pngBase64, "base64"));
    await updateSettings(req.tenantId!, {
      ticketLogo: logo.png,
      ticketLogoHash: logo.hash,
      ticketLogoWidth: logo.width,
      ticketLogoHeight: logo.height,
    });
    await bumpConfig(req.tenantId!);
    res.json(await view(req.tenantId!));
  }),
);

settingsRouter.delete(
  "/settings/ticket/logo",
  h(async (req, res) => {
    await updateSettings(req.tenantId!, {
      ticketLogo: null,
      ticketLogoHash: null,
      ticketLogoWidth: null,
      ticketLogoHeight: null,
    });
    await bumpConfig(req.tenantId!);
    res.json(await view(req.tenantId!));
  }),
);

// Ticket de muestra en la impresora de tickets de cada TPV conectado, para
// ver el diseño en papel. Cada TPV responde cómo le ha ido.
settingsRouter.post(
  "/settings/ticket/test-print",
  h(async (req, res) => {
    const results = await requestFromDevices<{ ok: boolean; printerName?: string; error?: string }>(
      req.tenantId!,
      "print:sample-receipt",
      {},
      45_000,
    );
    res.json({ results });
  }),
);

settingsRouter.put(
  "/settings/online-payments",
  h(async (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    if (enabled && !config.paymentProvider) {
      throw new HttpError(409, "El pago desde el móvil no está disponible: falta configurar una pasarela de pago en el servidor");
    }
    await updateSettings(req.tenantId!, { onlinePaymentsEnabled: enabled });
    res.json(await view(req.tenantId!));
  }),
);
