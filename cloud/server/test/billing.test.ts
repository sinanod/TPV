import { execFileSync, spawnSync } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import https from "https";
import os from "os";
import path from "path";
import { TLSSocket } from "tls";
import request from "supertest";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/auth";
import { runAeatSender, sendPendingForTenant } from "../src/aeat/sender";
import { runEmailSender } from "../src/email/sender";
import { buildRegistroAlta, qrUrl, taxBreakdown, TaxBreakdownItem } from "../../../server/src/fiscal/verifactu";

const app = createApp();
const CERTS = path.join(__dirname, ".certs");
const SPECS = path.join(__dirname, "..", "..", "..", "specs", "aeat");
const hasXmllint = spawnSync("xmllint", ["--version"]).status === 0;

function xmllint(xml: string, schema: string) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aeat-")), "doc.xml");
  fs.writeFileSync(file, xml);
  const r = spawnSync("xmllint", ["--nonet", "--noout", "--schema", path.join(SPECS, schema), file], { encoding: "utf8" });
  return r.status === 0 ? null : r.stderr;
}

// ---------- AEAT simulada: mTLS + validación XSD de lo recibido ----------

interface AeatCall {
  clientSubject: string;
  body: string;
  xsdError: string | null;
}
const aeatCalls: AeatCall[] = [];
const rejectNumSeries = new Set<string>();

function aeatResponse(body: string) {
  const nif = body.match(/<sum1:NIF>([^<]+)<\/sum1:NIF>/)![1];
  const name = body.match(/<sum1:NombreRazon>([^<]+)<\/sum1:NombreRazon>/)![1];
  const records = [...body.matchAll(/<sf:NumSerieFactura>([^<]+)<\/sf:NumSerieFactura><sf:FechaExpedicionFactura>([^<]+)</g)]
    // El primer NumSerie de cada registro es el suyo; el del encadenamiento va tras IDEmisorFactura de RegistroAnterior
    .filter((m, i, all) => all.findIndex((x) => x[1] === m[1]) === i);
  const own = [...body.matchAll(/<sf:IDFactura><sf:IDEmisorFactura>[^<]+<\/sf:IDEmisorFactura><sf:NumSerieFactura>([^<]+)<\/sf:NumSerieFactura><sf:FechaExpedicionFactura>([^<]+)</g)];
  void records;
  const lines = own.map(([, numSerie, fecha]) => {
    const bad = rejectNumSeries.has(numSerie);
    return (
      "<sfR:RespuestaLinea>" +
      `<sfR:IDFactura><sf:IDEmisorFactura>${nif}</sf:IDEmisorFactura><sf:NumSerieFactura>${numSerie}</sf:NumSerieFactura><sf:FechaExpedicionFactura>${fecha}</sf:FechaExpedicionFactura></sfR:IDFactura>` +
      "<sfR:Operacion><sf:TipoOperacion>Alta</sf:TipoOperacion></sfR:Operacion>" +
      `<sfR:EstadoRegistro>${bad ? "Incorrecto" : "Correcto"}</sfR:EstadoRegistro>` +
      (bad ? "<sfR:CodigoErrorRegistro>1100</sfR:CodigoErrorRegistro><sfR:DescripcionErrorRegistro>Valor o tipo incorrecto del campo</sfR:DescripcionErrorRegistro>" : "") +
      "</sfR:RespuestaLinea>"
    );
  });
  const estado = own.every(([, n]) => rejectNumSeries.has(n)) ? "Incorrecto" : own.some(([, n]) => rejectNumSeries.has(n)) ? "ParcialmenteCorrecto" : "Correcto";
  const respuesta =
    '<sfR:RespuestaRegFactuSistemaFacturacion xmlns:sfR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd"' +
    ' xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">' +
    "<sfR:CSV>A-TESTCSV12345678</sfR:CSV>" +
    `<sfR:DatosPresentacion><sf:NIFPresentador>${nif}</sf:NIFPresentador><sf:TimestampPresentacion>2026-10-20T12:00:00+02:00</sf:TimestampPresentacion></sfR:DatosPresentacion>` +
    `<sfR:Cabecera><sf:ObligadoEmision><sf:NombreRazon>${name}</sf:NombreRazon><sf:NIF>${nif}</sf:NIF></sf:ObligadoEmision></sfR:Cabecera>` +
    "<sfR:TiempoEsperaEnvio>60</sfR:TiempoEsperaEnvio>" +
    `<sfR:EstadoEnvio>${estado}</sfR:EstadoEnvio>` +
    lines.join("") +
    "</sfR:RespuestaRegFactuSistemaFacturacion>";
  return {
    respuesta,
    envelope: `<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Header/><env:Body>${respuesta}</env:Body></env:Envelope>`,
  };
}

let aeat: https.Server;
let smtp: SMTPServer;
const mails: string[] = [];

// ---------- Datos ----------

let tenantId: string;
let portal: string;
let device: string;
let deviceId: string;
let tableId: string;
let tableToken: string;
let productId: string;

async function login(username: string) {
  return (await request(app).post("/api/auth/login").send({ username, password: "contraseña-segura" })).body.token as string;
}

async function registerDevice(username: string) {
  const res = await request(app).post("/api/sync/register").send({ username, password: "contraseña-segura", deviceName: "PC barra" });
  return res.body as { deviceToken: string; deviceId: string };
}

const sendEvents = (events: unknown[], token = device) =>
  request(app).post("/api/sync/events").set("Authorization", `Bearer ${token}`).send({ events });

beforeAll(async () => {
  aeat = https.createServer(
    {
      key: fs.readFileSync(path.join(CERTS, "server.key")),
      cert: fs.readFileSync(path.join(CERTS, "server.pem")),
      ca: fs.readFileSync(path.join(CERTS, "ca.pem")),
      requestCert: true,
      rejectUnauthorized: true,
    },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const regFactu = body.match(/<sum:RegFactuSistemaFacturacion[\s\S]*<\/sum:RegFactuSistemaFacturacion>/)![0];
        const peer = (req.socket as TLSSocket).getPeerCertificate();
        aeatCalls.push({
          clientSubject: String(peer.subject?.CN ?? ""),
          body,
          xsdError: hasXmllint ? xmllint(regFactu, "SuministroLR.xsd") : null,
        });
        res.writeHead(200, { "Content-Type": "text/xml; charset=UTF-8" });
        res.end(aeatResponse(body).envelope);
      });
    },
  );
  await new Promise<void>((r) => aeat.listen(8443, "127.0.0.1", () => r()));

  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, _session, cb) {
      let data = "";
      stream.on("data", (c) => (data += c.toString()));
      stream.on("end", () => {
        mails.push(data);
        cb();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(2526, "127.0.0.1", () => r()));

  const tenant = await prisma.tenant.create({
    data: {
      name: "Bar Pepe",
      username: "barpepe-f",
      passwordHash: await hashPassword("contraseña-segura"),
      staff: { create: { name: "Encargado", pin: "0000", role: "ADMIN" } },
    },
  });
  tenantId = tenant.id;
  const zone = await prisma.zone.create({ data: { tenantId, name: "Terraza" } });
  const table = await prisma.diningTable.create({ data: { tenantId, zoneId: zone.id, number: 3 } });
  tableId = table.id;
  tableToken = table.qrToken;
  const category = await prisma.category.create({ data: { tenantId, name: "Comida" } });
  productId = (await prisma.product.create({ data: { tenantId, categoryId: category.id, name: "Bravas", price: 6.5 } })).id;

  portal = await login("barpepe-f");
  const reg = await registerDevice("barpepe-f");
  device = reg.deviceToken;
  deviceId = reg.deviceId;
});

afterAll(async () => {
  aeat.close();
  smtp.close();
  await prisma.$disconnect();
});

const auth = () => ({ Authorization: `Bearer ${portal}` });

// Registro de alta tal y como lo genera el TPV local
let chain: { numSerie: string; issueDate: string; hash: string; seq: number } | null = null;
function invoiceEvent(totalCents: number, opts: { emails?: string[]; environment?: "TEST" | "PRODUCTION" } = {}) {
  const seq = (chain?.seq ?? 0) + 1;
  const numSerie = `T1-2026-${String(seq).padStart(6, "0")}`;
  const issuedAt = new Date();
  const breakdown: TaxBreakdownItem[] = taxBreakdown([{ grossCents: totalCents, taxRate: 10 }]);
  const record = buildRegistroAlta({
    issuerNif: "B76543214",
    issuerName: "Bar Pepe SL",
    numSerie,
    issuedAt,
    generatedAt: issuedAt,
    description: "Servicio de restauración",
    breakdown,
    previous: chain ? { nif: "B76543214", numSerie: chain.numSerie, issueDate: chain.issueDate, hash: chain.hash } : null,
    sif: {
      producerName: "Software TPV SL",
      producerNif: "B12345674",
      systemName: "TPV",
      systemId: "TP",
      version: "1.0.0",
      installationNumber: deviceId,
    },
  });
  chain = { numSerie, issueDate: record.issueDate, hash: record.hash, seq };
  const orderUuid = randomUUID();
  return {
    id: randomUUID(),
    type: "invoice.issued",
    at: issuedAt.toISOString(),
    data: {
      uuid: randomUUID(),
      orderUuid,
      numSerie,
      issuedAt: issuedAt.toISOString(),
      issueDate: record.issueDate,
      totalCents,
      taxCents: record.taxCents,
      breakdown,
      tableLabel: "Terraza · Mesa 3",
      waiterName: "Ana",
      lines: [{ name: "Bravas", qty: 1, unitPrice: totalCents / 100, taxRate: 10, totalCents }],
      payments: [
        { uuid: randomUUID(), method: "CARD", amountCents: totalCents, tenderedCents: null, refundCents: 0, onlinePaymentId: null, createdAt: issuedAt.toISOString() },
      ],
      emails: opts.emails ?? [],
      verifactu: {
        chainSeq: seq,
        issuerNif: "B76543214",
        hash: record.hash,
        recordXml: record.xml,
        qrUrl: qrUrl(opts.environment ?? "TEST", "B76543214", numSerie, issuedAt, totalCents),
        environment: opts.environment ?? "TEST",
      },
    },
  };
}

describe("impresoras y familias", () => {
  it("cada familia apunta a una impresora y el TPV recibe impresoras, IVA, ajustes y su serie", async () => {
    const cocina = await request(app)
      .post("/api/portal/printers")
      .set(auth())
      .send({ name: "Cocina", type: "NETWORK", address: "192.168.1.50" });
    expect(cocina.status).toBe(201);
    const usb = await request(app)
      .post("/api/portal/printers")
      .set(auth())
      .send({ name: "Tickets", type: "SYSTEM", address: "EPSON TM-T20", width: 80 });
    expect(usb.status).toBe(201);

    const familia = await request(app).post("/api/portal/categories").set(auth()).send({ name: "Bebidas", printerId: cocina.body.id });
    expect(familia.body.printerId).toBe(cocina.body.id);
    const vino = await request(app)
      .post("/api/portal/products")
      .set(auth())
      .send({ categoryId: familia.body.id, name: "Vermut", price: 3, taxRate: 21 });
    expect(vino.body.taxRate).toBe(21);
    const badRate = await request(app)
      .post("/api/portal/products")
      .set(auth())
      .send({ categoryId: familia.body.id, name: "Raro", price: 3, taxRate: 7 });
    expect(badRate.status).toBe(400);

    const snap = await request(app).get("/api/sync/config").set("Authorization", `Bearer ${device}`);
    expect(snap.body.printers.map((p: { name: string }) => p.name).sort()).toEqual(["Cocina", "Tickets"]);
    expect(snap.body.categories.find((c: { name: string }) => c.name === "Bebidas").printerId).toBe(cocina.body.id);
    expect(snap.body.products.find((p: { name: string }) => p.name === "Vermut").taxRate).toBe(21);
    expect(snap.body.device).toEqual({ invoiceSeries: "T1", installationNumber: deviceId });
    expect(snap.body.settings.sif).toMatchObject({ producerNif: "B12345674", systemId: "TP" });

    // Un segundo TPV del mismo restaurante factura con otra serie
    const second = await registerDevice("barpepe-f");
    const snap2 = await request(app).get("/api/sync/config").set("Authorization", `Bearer ${second.deviceToken}`);
    expect(snap2.body.device.invoiceSeries).toBe("T2");

    // Borrar una impresora deja la familia sin impresora (no rompe nada)
    await request(app).delete(`/api/portal/printers/${cocina.body.id}`).set(auth()).expect(204);
    const after = await request(app).get("/api/sync/config").set("Authorization", `Bearer ${device}`);
    expect(after.body.categories.find((c: { name: string }) => c.name === "Bebidas").printerId).toBeNull();
  });
});

describe("ajustes fiscales y VERI*FACTU", () => {
  it("valida el NIF y exige datos y certificado antes de activar VERI*FACTU", async () => {
    const badNif = await request(app)
      .put("/api/portal/settings/business")
      .set(auth())
      .send({ legalName: "Bar Pepe SL", nif: "B76543211" });
    expect(badNif.status).toBe(400);

    const early = await request(app).put("/api/portal/settings/verifactu").set(auth()).send({ enabled: true, environment: "TEST" });
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/Razón social.*NIF.*Certificado/);

    await request(app)
      .put("/api/portal/settings/business")
      .set(auth())
      .send({ tradeName: "Bar Pepe", legalName: "Bar Pepe SL", nif: "b-76543214", address: "Calle Mayor 1" })
      .expect(200);

    const pfxBase64 = fs.readFileSync(path.join(CERTS, "client.pfx")).toString("base64");
    const wrong = await request(app).put("/api/portal/settings/certificate").set(auth()).send({ pfxBase64, password: "mala" });
    expect(wrong.status).toBe(400);
    const cert = await request(app).put("/api/portal/settings/certificate").set(auth()).send({ pfxBase64, password: "secreto" });
    expect(cert.status).toBe(200);
    expect(cert.body.verifactu.certificate.subject).toBe("BAR PEPE SL · IDCES-B76543214");

    // En la base de datos el certificado no está en claro
    const stored = await prisma.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
    expect(Buffer.from(stored.certificatePfx!).includes(Buffer.from(pfxBase64, "base64").subarray(0, 64))).toBe(false);

    const on = await request(app).put("/api/portal/settings/verifactu").set(auth()).send({ enabled: true, environment: "TEST" });
    expect(on.status).toBe(200);
    expect(on.body.verifactu).toMatchObject({ enabled: true, environment: "TEST", missing: [] });

    const snap = await request(app).get("/api/sync/config").set("Authorization", `Bearer ${device}`);
    expect(snap.body.settings.business).toMatchObject({ nif: "B76543214", legalName: "Bar Pepe SL", name: "Bar Pepe" });
    expect(snap.body.settings.verifactu).toEqual({ enabled: true, environment: "TEST", endDate: null });
  });

  it("remite a la AEAT con el certificado del restaurante, en orden de cadena y respetando la espera", async () => {
    const events = [invoiceEvent(650), invoiceEvent(1300), invoiceEvent(220)];
    rejectNumSeries.add(events[2].data.numSerie);
    const res = await sendEvents(events);
    expect(res.body.accepted).toHaveLength(3);
    expect(await prisma.invoice.count({ where: { tenantId, aeatStatus: "PENDING" } })).toBe(3);

    await sendPendingForTenant(tenantId);
    expect(aeatCalls).toHaveLength(1);
    const call = aeatCalls[0];
    expect(call.clientSubject).toBe("BAR PEPE SL");
    expect(call.xsdError).toBeNull();
    // Los registros viajan exactamente como los generó el TPV
    for (const e of events) expect(call.body).toContain(e.data.verifactu.recordXml);
    const order = events.map((e) => call.body.indexOf(e.data.numSerie));
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const invoices = await prisma.invoice.findMany({ where: { tenantId }, orderBy: { chainSeq: "asc" }, include: { submission: true } });
    expect(invoices.map((i) => i.aeatStatus)).toEqual(["CORRECT", "CORRECT", "REJECTED"]);
    expect(invoices[2]).toMatchObject({ aeatErrorCode: "1100" });
    expect(invoices[0].submission?.csv).toBe("A-TESTCSV12345678");

    // Control de flujo: con la espera de 60 s pendiente no se vuelve a enviar
    await sendEvents([invoiceEvent(400)]);
    await runAeatSender();
    expect(aeatCalls).toHaveLength(1);
    await sendPendingForTenant(tenantId, new Date(Date.now() + 61_000));
    expect(aeatCalls).toHaveLength(2);
  });

  it.skipIf(!hasXmllint)("la respuesta simulada cumple el esquema oficial de respuesta", () => {
    expect(xmllint(aeatResponse(aeatCalls[0].body).respuesta, "RespuestaSuministro.xsd")).toBeNull();
  });

  it("al renunciar en producción sigue activo hasta el 31/12 y lo comunica como FechaFinVeriFactu", async () => {
    await request(app).put("/api/portal/settings/verifactu").set(auth()).send({ enabled: true, environment: "PRODUCTION" }).expect(200);
    await sendEvents([invoiceEvent(500, { environment: "PRODUCTION" })]);
    await sendPendingForTenant(tenantId, new Date(Date.now() + 200_000));
    const s = await prisma.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
    expect(s.verifactuFirstSentAt).not.toBeNull();

    const back = await request(app).put("/api/portal/settings/verifactu").set(auth()).send({ enabled: true, environment: "TEST" });
    expect(back.status).toBe(409);

    const off = await request(app).put("/api/portal/settings/verifactu").set(auth()).send({ enabled: false, environment: "PRODUCTION" });
    const year = new Date().getFullYear();
    expect(off.body.verifactu).toMatchObject({ enabled: true, endDate: `${year}-12-31` });
    expect(off.body.message).toMatch(/31\/12/);

    await sendEvents([invoiceEvent(600, { environment: "PRODUCTION" })]);
    await sendPendingForTenant(tenantId, new Date(Date.now() + 400_000));
    const last = aeatCalls.at(-1)!;
    expect(last.body).toContain(`<sum1:RemisionVoluntaria><sum1:FechaFinVeriFactu>31-12-${year}</sum1:FechaFinVeriFactu></sum1:RemisionVoluntaria>`);
    expect(last.xsdError).toBeNull();
  });
});

describe("ticket por email", () => {
  it("envía el ticket con el QR tributario a los emails recogidos al cobrar", async () => {
    const e = invoiceEvent(1840, { emails: ["cliente@example.com"] });
    await sendEvents([e]);
    await runEmailSender();
    expect(mails).toHaveLength(1);
    const mail = mails[0];
    expect(mail).toMatch(/To: cliente@example\.com/);
    expect(mail).toContain(e.data.numSerie);
    expect(mail).toMatch(/Content-ID: <qr-tributario>/);
    expect(mail).toContain("VERI*FACTU");
    const msg = await prisma.emailMessage.findFirstOrThrow({ where: { to: "cliente@example.com" } });
    expect(msg.status).toBe("SENT");

    // El mismo evento repetido no duplica el email
    await sendEvents([{ ...e, id: randomUUID() }]);
    await runEmailSender();
    expect(mails).toHaveLength(1);

    // Pedido después desde el TPV
    await sendEvents([{ id: randomUUID(), type: "invoice.email", at: new Date().toISOString(), data: { invoiceUuid: e.data.uuid, email: "otro@example.com" } }]);
    await runEmailSender();
    expect(mails).toHaveLength(2);
    expect(mails[1]).toMatch(/To: otro@example\.com/);
  });
});

describe("pago del cliente desde el móvil", () => {
  const orderUuid = randomUUID();
  const orderEvent = (payments: unknown[] = []) => ({
    id: randomUUID(),
    type: "order.upsert",
    at: new Date().toISOString(),
    data: {
      localUuid: orderUuid,
      tableId,
      tableLabel: "Terraza · Mesa 3",
      waiterName: "Ana",
      status: "SENT",
      paymentMethod: null,
      total: 19.5,
      openedAt: new Date().toISOString(),
      closedAt: null,
      lines: [{ productId, productName: "Bravas", qty: 3, unitPrice: 6.5, note: null, status: "SENT" }],
      payments,
    },
  });

  it("el cliente ve la cuenta de su mesa, paga una parte y el TPV lo recoge una sola vez", async () => {
    await sendEvents([orderEvent()]);

    const closed = await request(app).get(`/api/public/tables/${tableToken}`);
    expect(closed.body.onlinePayments.enabled).toBe(false);
    const refused = await request(app).post(`/api/public/tables/${tableToken}/payments`).send({ amountCents: 500 });
    expect(refused.status).toBe(409);

    await request(app).put("/api/portal/settings/online-payments").set(auth()).send({ enabled: true }).expect(200);
    const view = await request(app).get(`/api/public/tables/${tableToken}`);
    expect(view.body).toMatchObject({
      restaurant: "Bar Pepe",
      table: "Terraza · Mesa 3",
      onlinePayments: { enabled: true, demo: true },
      bill: { totalCents: 1950, paidCents: 0, pendingCents: 1950 },
    });

    const tooMuch = await request(app).post(`/api/public/tables/${tableToken}/payments`).send({ amountCents: 5000 });
    expect(tooMuch.status).toBe(400);

    const pay = await request(app)
      .post(`/api/public/tables/${tableToken}/payments`)
      .send({ amountCents: 650, email: "Cliente@Example.com" });
    expect(pay.status).toBe(201);
    expect(pay.body.redirectUrl).toBe(`/pago-demo/${pay.body.paymentId}`);

    // Antes de confirmar no cuenta como pagado ni le llega al TPV
    let pending = await request(app).get("/api/sync/online-payments").set("Authorization", `Bearer ${device}`);
    expect(pending.body).toEqual([]);

    await request(app).post(`/api/public/payments/${pay.body.paymentId}/demo/confirm`).expect(200);
    await request(app).post(`/api/public/payments/${pay.body.paymentId}/demo/confirm`).expect(409);

    pending = await request(app).get("/api/sync/online-payments").set("Authorization", `Bearer ${device}`);
    expect(pending.body).toEqual([{ id: pay.body.paymentId, orderLocalUuid: orderUuid, amountCents: 650, email: "cliente@example.com" }]);
    // Mientras el TPV no lo registra, el pendiente ya lo descuenta (evita cobrar dos veces)
    expect((await request(app).get(`/api/public/tables/${tableToken}`)).body.bill.pendingCents).toBe(1300);

    // Otro restaurante no puede ver ni recoger ese pago
    const other = await prisma.tenant.create({
      data: { name: "Otro", username: "otro-f", passwordHash: await hashPassword("contraseña-segura") },
    });
    const otherDevice = await registerDevice("otro-f");
    expect((await request(app).get("/api/sync/online-payments").set("Authorization", `Bearer ${otherDevice.deviceToken}`)).body).toEqual([]);
    await prisma.device.deleteMany({ where: { tenantId: other.id } });

    // El TPV lo registra
    const paymentUuid = randomUUID();
    await sendEvents([
      { id: randomUUID(), type: "payment.applied", at: new Date().toISOString(), data: { onlinePaymentId: pay.body.paymentId, result: "APPLIED", refundCents: 0, localPaymentUuid: paymentUuid } },
      orderEvent([{ uuid: paymentUuid, method: "ONLINE", amountCents: 650, tenderedCents: null, refundCents: 0, onlinePaymentId: pay.body.paymentId, createdAt: new Date().toISOString() }]),
    ]);
    pending = await request(app).get("/api/sync/online-payments").set("Authorization", `Bearer ${device}`);
    expect(pending.body).toEqual([]);
    const status = await request(app).get(`/api/public/payments/${pay.body.paymentId}`);
    expect(status.body).toMatchObject({ status: "SUCCEEDED", registeredByRestaurant: true, amountCents: 650 });
    expect((await request(app).get(`/api/public/tables/${tableToken}`)).body.bill).toMatchObject({ paidCents: 650, pendingCents: 1300 });
  });

  it("un QR antiguo deja de funcionar al regenerarlo", async () => {
    await request(app).post(`/api/portal/tables/${tableId}/qr/rotate`).set(auth()).expect(204);
    expect((await request(app).get(`/api/public/tables/${tableToken}`)).status).toBe(404);
    const qr = await request(app).get("/api/portal/tables/qr").set(auth());
    expect(qr.body[0].url).toMatch(/\/m\/[0-9a-f-]{36}$/);
  });
});

describe("ventas", () => {
  it("una cuenta dividida suma en cada forma de pago", async () => {
    const now = new Date();
    await sendEvents([
      {
        id: randomUUID(),
        type: "order.upsert",
        at: now.toISOString(),
        data: {
          localUuid: randomUUID(),
          tableId,
          tableLabel: "Terraza · Mesa 3",
          waiterName: "Ana",
          status: "PAID",
          paymentMethod: "MIXED",
          total: 30,
          openedAt: now.toISOString(),
          closedAt: now.toISOString(),
          lines: [{ productId, productName: "Bravas", qty: 1, unitPrice: 30, note: null, status: "SENT" }],
          payments: [
            { uuid: randomUUID(), method: "CARD", amountCents: 1200, tenderedCents: null, refundCents: 0, onlinePaymentId: null, createdAt: now.toISOString() },
            { uuid: randomUUID(), method: "CASH", amountCents: 1800, tenderedCents: 2000, refundCents: 0, onlinePaymentId: null, createdAt: now.toISOString() },
          ],
        },
      },
    ]);
    const from = new Date(now.getTime() - 60_000).toISOString();
    const to = new Date(now.getTime() + 60_000).toISOString();
    const sales = await request(app).get("/api/portal/sales").query({ from, to }).set(auth());
    expect(sales.body.totals.byPayment).toEqual({ CARD: 12, CASH: 18 });
  });
});
