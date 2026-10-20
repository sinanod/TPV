import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import { io as ioClient, Socket } from "socket.io-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { initRealtime } from "../src/realtime";
import { initPrintAgent } from "../src/printing/agent";
import { prisma } from "../src/db";
import { DEFAULT_SETTINGS, saveSettings, Settings } from "../src/settings";
import { altaHash, formatCents } from "../src/fiscal/verifactu";
import { registerPayment } from "../src/billing";

const SPECS = path.join(__dirname, "..", "..", "specs", "aeat");
const hasXmllint = spawnSync("xmllint", ["--version"]).status === 0;

// ---------- Impresoras de red falsas: guardan lo que reciben ----------

interface FakePrinter {
  port: number;
  jobs: Buffer[];
  close: () => Promise<void>;
}

function startFakePrinter(): Promise<FakePrinter> {
  const jobs: Buffer[] = [];
  const server = net.createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on("data", (c) => chunks.push(c));
    socket.on("end", () => jobs.push(Buffer.concat(chunks)));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        jobs,
        close: () => new Promise((r) => server.close(() => r())),
      }),
    ),
  );
}

async function waitFor(check: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const text = (b: Buffer) => b.toString("latin1");

// ---------- Servidor del TPV ----------

let server: Server;
let base: string;
let kitchen: FakePrinter;
let bar: FakePrinter;
let tickets: FakePrinter;
let token: string;
let ids: { kitchenPrinter: number; barPrinter: number; ticketPrinter: number; table: number; table2: number };
let products: Record<string, number>;

async function api(method: string, url: string, body?: unknown, auth = token) {
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const verifactuSettings = (ticketPrinter: number): Settings => ({
  ...DEFAULT_SETTINGS,
  invoiceSeries: "T1",
  installationNumber: "inst-test-0001",
  receiptPrinterId: ticketPrinter,
  business: {
    name: "Bar Pepe",
    legalName: "Bar Pepe SL",
    nif: "B76543214",
    address: "Calle Mayor 1, Madrid",
    ticketFooter: "¡Gracias por su visita!",
  },
  verifactu: { enabled: true, environment: "TEST", endDate: null },
  sif: { producerName: "Software TPV SL", producerNif: "B12345674", systemName: "TPV", systemId: "TP", version: "1.0.0" },
});

beforeAll(async () => {
  [kitchen, bar, tickets] = await Promise.all([startFakePrinter(), startFakePrinter(), startFakePrinter()]);

  const kitchenPrinter = await prisma.printer.create({ data: { name: "Cocina", address: "127.0.0.1", port: kitchen.port } });
  const barPrinter = await prisma.printer.create({ data: { name: "Barra", address: "127.0.0.1", port: bar.port, width: 58 } });
  const ticketPrinter = await prisma.printer.create({ data: { name: "Tickets", address: "127.0.0.1", port: tickets.port } });

  await prisma.user.create({ data: { name: "Ana", pin: "1111", role: "WAITER" } });
  const zone = await prisma.zone.create({ data: { name: "Interior" } });
  const table = await prisma.table.create({ data: { number: 1, zoneId: zone.id } });
  const table2 = await prisma.table.create({ data: { number: 2, zoneId: zone.id } });
  const bebidas = await prisma.category.create({ data: { name: "Bebidas", printerId: barPrinter.id } });
  const comida = await prisma.category.create({ data: { name: "Comida", printerId: kitchenPrinter.id } });
  const postres = await prisma.category.create({ data: { name: "Postres" } });
  products = {
    caña: (await prisma.product.create({ data: { name: "Caña", price: 2.2, categoryId: bebidas.id } })).id,
    gintonic: (await prisma.product.create({ data: { name: "Gin tonic", price: 9, taxRate: 21, categoryId: bebidas.id } })).id,
    bravas: (await prisma.product.create({ data: { name: "Patatas bravas", price: 6.5, categoryId: comida.id } })).id,
    tarta: (await prisma.product.create({ data: { name: "Tarta de queso", price: 4.5, categoryId: postres.id } })).id,
    banquete: (await prisma.product.create({ data: { name: "Banquete", price: 3500, categoryId: comida.id } })).id,
  };
  ids = { kitchenPrinter: kitchenPrinter.id, barPrinter: barPrinter.id, ticketPrinter: ticketPrinter.id, table: table.id, table2: table2.id };
  await saveSettings(prisma, verifactuSettings(ticketPrinter.id));

  server = createServer(createApp());
  initPrintAgent(initRealtime(server));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  token = (await api("POST", "/auth/login", { pin: "1111" }, "")).body.token;
});

afterAll(async () => {
  server.close();
  await Promise.all([kitchen.close(), bar.close(), tickets.close()]);
  await prisma.$disconnect();
});

beforeEach(() => {
  kitchen.jobs.length = 0;
  bar.jobs.length = 0;
  tickets.jobs.length = 0;
});

async function openWith(tableId: number, lines: { productId: number; qty: number; note?: string }[]) {
  const { body } = await api("POST", `/tables/${tableId}/open`);
  await api("POST", `/orders/${body.order.id}/lines`, { lines });
  return body.order.id as number;
}

describe("comanda: cada familia sale en su impresora", () => {
  it("bebidas a barra, comida a cocina, postres (sin impresora) a ninguna", async () => {
    const orderId = await openWith(ids.table, [
      { productId: products.caña, qty: 2 },
      { productId: products.bravas, qty: 1, note: "poco picantes" },
      { productId: products.tarta, qty: 1 },
    ]);
    const sent = await api("POST", `/orders/${orderId}/send`);
    expect(sent.status).toBe(200);
    expect(sent.body.prints.map((p: { printerName: string; ok: boolean }) => [p.printerName, p.ok]).sort()).toEqual([
      ["Barra", true],
      ["Cocina", true],
    ]);

    await waitFor(() => kitchen.jobs.length === 1 && bar.jobs.length === 1);
    expect(text(kitchen.jobs[0])).toContain("Patatas bravas");
    expect(text(kitchen.jobs[0])).toContain("poco picantes");
    expect(text(kitchen.jobs[0])).not.toContain("Ca");
    expect(text(bar.jobs[0])).toContain("2 x Ca\xa4a"); // ñ en PC858
    expect(text(bar.jobs[0])).not.toContain("bravas");
    expect(tickets.jobs).toHaveLength(0);

    // Solo se imprimen las líneas nuevas al volver a enviar
    await api("POST", `/orders/${orderId}/lines`, { lines: [{ productId: products.caña, qty: 1 }] });
    await api("POST", `/orders/${orderId}/send`);
    await waitFor(() => bar.jobs.length === 2);
    expect(kitchen.jobs).toHaveLength(1);
    expect(text(bar.jobs[1])).toContain("1 x Ca");

    await api("POST", `/orders/${orderId}/close`, { paymentMethod: "CASH" });
  });

  it("si la impresora no responde, la comanda se envía igual y el fallo queda para reintentar", async () => {
    const down = await prisma.printer.create({ data: { name: "Cocina 2", address: "127.0.0.1", port: 1 } });
    const familia = await prisma.category.create({ data: { name: "Plancha", printerId: down.id } });
    const solomillo = await prisma.product.create({ data: { name: "Solomillo", price: 18, categoryId: familia.id } });

    const orderId = await openWith(ids.table, [{ productId: solomillo.id, qty: 1 }]);
    const sent = await api("POST", `/orders/${orderId}/send`);
    expect(sent.status).toBe(200);
    expect(sent.body.prints[0]).toMatchObject({ printerName: "Cocina 2", ok: false });

    const failed = await api("GET", "/print-jobs/failed");
    expect(failed.body[0]).toMatchObject({ title: "Comanda Interior · Mesa 1", printerName: "Cocina 2" });

    // Se arregla la impresora (aquí: se apunta a una que funciona) y se reintenta
    await prisma.printer.update({ where: { id: down.id }, data: { port: kitchen.port } });
    const retry = await api("POST", `/print-jobs/${failed.body[0].id}/retry`);
    expect(retry.body.ok).toBe(true);
    await waitFor(() => kitchen.jobs.length === 1);
    expect(text(kitchen.jobs[0])).toContain("Solomillo");

    await api("POST", `/orders/${orderId}/close`, { paymentMethod: "CARD" });
  });
});

describe("cobro en mesa", () => {
  it("cuenta dividida: tarjeta + efectivo con cambio, factura simplificada y ticket con QR", async () => {
    const orderId = await openWith(ids.table, [
      { productId: products.caña, qty: 2 }, // 4,40 al 10%
      { productId: products.gintonic, qty: 1 }, // 9,00 al 21%
    ]);

    const first = await api("POST", `/orders/${orderId}/payments`, { method: "CARD", amount: 5, email: "ana@example.com" });
    expect(first.status).toBe(201);
    expect(first.body.order).toMatchObject({ total: 13.4, paid: 5, pending: 8.4 });
    expect(first.body.invoice).toBeNull();
    expect(tickets.jobs).toHaveLength(0);

    const tooMuch = await api("POST", `/orders/${orderId}/payments`, { method: "CARD", amount: 20 });
    expect(tooMuch.status).toBe(400);

    const last = await api("POST", `/orders/${orderId}/payments`, { method: "CASH", amount: 8.4, tendered: 10 });
    expect(last.status).toBe(201);
    expect(last.body.change).toBe(1.6);
    expect(last.body.invoice.numSerie).toMatch(/^T1-\d{4}-\d{6}$/);
    expect(last.body.order.status).toBe("PAID");
    expect(last.body.order.paymentMethod).toBe("MIXED");

    const table = await prisma.table.findUniqueOrThrow({ where: { id: ids.table } });
    expect(table.status).toBe("FREE");

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { orderId } });
    expect(invoice.totalCents).toBe(1340);
    expect(JSON.parse(invoice.breakdown)).toEqual([
      { rate: 10, baseCents: 400, quotaCents: 40 },
      { rate: 21, baseCents: 744, quotaCents: 156 },
    ]);
    expect(invoice.qrUrl).toBe(
      `https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B76543214&numserie=${encodeURIComponent(invoice.numSerie)}&fecha=${invoice.issueDate}&importe=13.40`,
    );

    await waitFor(() => tickets.jobs.length === 1);
    const ticket = text(tickets.jobs[0]);
    expect(ticket.indexOf("QR tributario:")).toBeLessThan(ticket.indexOf("Bar Pepe"));
    expect(ticket).toContain("VERI*FACTU");
    expect(ticket).toContain(invoice.qrUrl!);
    expect(ticket).toContain("FACTURA SIMPLIFICADA");
    expect(ticket).toContain("13,40 \xd5"); // € en PC858
    expect(ticket).toContain("Cambio");
  });

  it("la cadena VERI*FACTU enlaza cada registro con el anterior y valida contra el XSD", async () => {
    const orderId = await openWith(ids.table2, [{ productId: products.bravas, qty: 2 }]);
    await api("POST", `/orders/${orderId}/close`, { paymentMethod: "CARD" });

    const chain = await prisma.invoice.findMany({ where: { chainSeq: { not: null } }, orderBy: { chainSeq: "asc" } });
    expect(chain.length).toBeGreaterThanOrEqual(2);
    expect(chain[0].recordXml).toContain("<sf:PrimerRegistro>S</sf:PrimerRegistro>");
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1];
      const cur = chain[i];
      expect(cur.chainSeq).toBe(prev.chainSeq! + 1);
      expect(cur.recordXml).toContain(
        `<sf:RegistroAnterior><sf:IDEmisorFactura>B76543214</sf:IDEmisorFactura><sf:NumSerieFactura>${prev.numSerie}</sf:NumSerieFactura><sf:FechaExpedicionFactura>${prev.issueDate}</sf:FechaExpedicionFactura><sf:Huella>${prev.hash}</sf:Huella></sf:RegistroAnterior>`,
      );
      const ts = cur.recordXml!.match(/<sf:FechaHoraHusoGenRegistro>(.+?)</)![1];
      expect(cur.hash).toBe(
        altaHash({
          IDEmisorFactura: "B76543214",
          NumSerieFactura: cur.numSerie,
          FechaExpedicionFactura: cur.issueDate,
          TipoFactura: "F2",
          CuotaTotal: formatCents(cur.taxCents),
          ImporteTotal: formatCents(cur.totalCents),
          Huella: prev.hash!,
          FechaHoraHusoGenRegistro: ts,
        }),
      );
    }

    if (hasXmllint) {
      const doc =
        '<sfLR:RegFactuSistemaFacturacion xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd"' +
        ' xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">' +
        "<sfLR:Cabecera><sf:ObligadoEmision><sf:NombreRazon>Bar Pepe SL</sf:NombreRazon><sf:NIF>B76543214</sf:NIF></sf:ObligadoEmision></sfLR:Cabecera>" +
        chain.map((c) => `<sfLR:RegistroFactura>${c.recordXml}</sfLR:RegistroFactura>`).join("") +
        "</sfLR:RegFactuSistemaFacturacion>";
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vf-")), "envio.xml");
      fs.writeFileSync(file, doc);
      execFileSync("xmllint", ["--nonet", "--noout", "--schema", path.join(SPECS, "SuministroLR.xsd"), file], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
  });

  it("no deja quitar productos ya cobrados en parte", async () => {
    const orderId = await openWith(ids.table, [
      { productId: products.caña, qty: 1 },
      { productId: products.tarta, qty: 1 },
    ]);
    await api("POST", `/orders/${orderId}/payments`, { method: "CARD", amount: 6 });
    const order = await api("GET", `/orders/${orderId}`);
    const tarta = order.body.lines.find((l: { productId: number }) => l.productId === products.tarta);
    const del = await api("DELETE", `/orders/${orderId}/lines/${tarta.id}`);
    expect(del.status).toBe(409);
    await api("POST", `/orders/${orderId}/close`, { paymentMethod: "CASH" });
  });

  it("más de 3.000 € no se puede cerrar con factura simplificada", async () => {
    const orderId = await openWith(ids.table, [{ productId: products.banquete, qty: 1 }]);
    const res = await api("POST", `/orders/${orderId}/close`, { paymentMethod: "CARD" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/3\.000/);
    // La comanda sigue abierta y sin pagos registrados
    const order = await api("GET", `/orders/${orderId}`);
    expect(order.body.payments).toHaveLength(0);
    await api("DELETE", `/orders/${orderId}/lines/${order.body.lines[0].id}`);
    await api("POST", `/orders/${orderId}/close`, { paymentMethod: "CASH" });
  });

  it("mesa sin consumir: se libera sin factura", async () => {
    const { body } = await api("POST", `/tables/${ids.table}/open`);
    const res = await api("POST", `/orders/${body.order.id}/close`, { paymentMethod: "CASH" });
    expect(res.body.invoice).toBeNull();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: body.order.id } })).status).toBe("CANCELLED");
    expect(await prisma.invoice.count({ where: { orderId: body.order.id } })).toBe(0);
  });
});

describe("pago del cliente desde su móvil", () => {
  it("se aplica una sola vez aunque llegue repetido, y el exceso queda para devolver", async () => {
    const orderId = await openWith(ids.table, [{ productId: products.bravas, qty: 1 }]); // 6,50
    const first = await registerPayment(orderId, { method: "ONLINE", amountCents: 1000, email: "c@example.com", onlinePaymentId: "op-1" });
    expect(first.refundCents).toBe(350);
    expect(first.invoiceId).not.toBeNull();

    const again = await registerPayment(orderId, { method: "ONLINE", amountCents: 1000, onlinePaymentId: "op-1" });
    expect(again.duplicate).toBe(true);
    expect(await prisma.payment.count({ where: { onlinePaymentId: "op-1" } })).toBe(1);

    // Otro pago online cuando la mesa ya está cobrada: se registra entero para devolver
    const late = await registerPayment(orderId, { method: "ONLINE", amountCents: 650, onlinePaymentId: "op-2" });
    expect(late).toMatchObject({ refundCents: 650, invoiceId: null });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
    expect(order.payments.map((p) => [p.amount, p.refundAmount])).toEqual([
      [6.5, 3.5],
      [0, 6.5],
    ]);
  });
});

describe("impresoras USB a través de la app de escritorio", () => {
  let agent: Socket;
  const printed: { printerName: string; html: string }[] = [];

  beforeAll(async () => {
    agent = ioClient(`${base}/print-agent`, { auth: { token: "test-agent-token" }, transports: ["websocket"] });
    agent.on("print", (job: { printerName: string; html: string }, ack: (r: unknown) => void) => {
      printed.push(job);
      ack(job.printerName === "Atascada" ? { ok: false, error: "Sin papel" } : { ok: true });
    });
    await new Promise<void>((r) => agent.on("connect", () => r()));
    agent.emit("printers", ["EPSON TM-T20 (USB)", "Microsoft Print to PDF"]);
  });

  afterAll(() => {
    agent.disconnect();
  });

  it("rechaza agentes sin el token", async () => {
    const intruder = ioClient(`${base}/print-agent`, { auth: { token: "otro" }, transports: ["websocket"] });
    const err = await new Promise<Error>((r) => intruder.on("connect_error", r));
    expect(err.message).toBe("unauthorized");
    intruder.disconnect();
  });

  it("lista las impresoras del sistema y les envía el documento en HTML", async () => {
    await waitFor(() => true);
    const list = await api("GET", "/printers");
    expect(list.body.systemPrinters).toEqual(["EPSON TM-T20 (USB)", "Microsoft Print to PDF"]);

    const usb = await prisma.printer.create({ data: { name: "Barra USB", type: "SYSTEM", address: "EPSON TM-T20 (USB)", width: 80 } });
    const ok = await api("POST", `/printers/${usb.id}/test`);
    expect(ok.body).toMatchObject({ ok: true, printerName: "Barra USB" });
    expect(printed.at(-1)!.printerName).toBe("EPSON TM-T20 (USB)");
    expect(printed.at(-1)!.html).toContain("PRUEBA DE IMPRESIÓN");

    const jammed = await prisma.printer.create({ data: { name: "Atascada", type: "SYSTEM", address: "Atascada" } });
    const bad = await api("POST", `/printers/${jammed.id}/test`);
    expect(bad.body).toMatchObject({ ok: false, error: "Sin papel" });
  });
});
