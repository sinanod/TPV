import net from "net";
import { AddressInfo } from "net";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { DEFAULT_SETTINGS, DEFAULT_TICKET, getSettings, saveSettings, TicketDesign, TicketLogoInfo } from "../src/settings";
import { bill, receipt, ReceiptInput } from "../src/printing/document";
import { resolveImages } from "../src/printing/logo";
import { toEscPos } from "../src/printing/escpos";
import { toHtml } from "../src/printing/html";
import { decodePng, resize, toBitmap } from "../src/printing/raster";
import { printSampleReceipt } from "../src/printing/service";

/** Logo de prueba 200×80: mitad izquierda negra, mitad derecha blanca. */
function halfBlackPng() {
  const png = new PNG({ width: 200, height: 80, colorType: 2 });
  for (let i = 0; i < 200 * 80; i++) {
    const v = i % 200 < 100 ? 0 : 255;
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png, { colorType: 2 });
}

const LOGO: TicketLogoInfo = { hash: "logo-hash-1", width: 200, height: 80, sizePercent: 60, style: "THRESHOLD" };
const business = { name: "Bar Pepe", legalName: "BAR PEPE SL", nif: "B76543214", address: "C/ Mayor 1", ticketFooter: "" };

function sampleInput(design: TicketDesign): ReceiptInput {
  return {
    business,
    design,
    numSerie: "T1-2026-000007",
    issuedAt: new Date(2026, 9, 21, 13, 5),
    tableLabel: "Terraza · Mesa 4",
    waiterName: "Ana",
    lines: [{ qty: 1, name: "Caña", totalCents: 220 }],
    breakdown: [{ rate: 10, baseCents: 200, quotaCents: 20 }],
    totalCents: 220,
    payments: [{ method: "CARD", amountCents: 220, tenderedCents: null }],
    qrUrl: null,
  };
}

const texts = (doc: { blocks: { t: string }[] }) =>
  doc.blocks.flatMap((b) => ("text" in b ? [b.text as string] : "left" in b ? [b.left as string] : []));

beforeAll(async () => {
  await prisma.ticketLogo.deleteMany();
  await prisma.ticketLogo.create({ data: { id: 1, hash: LOGO.hash, png: halfBlackPng() } });
});

afterAll(async () => {
  await prisma.ticketLogo.deleteMany();
  await prisma.localSettings.deleteMany();
});

describe("diseño del ticket", () => {
  it("cabecera, texto libre y pie configurables; mesa y camarero se pueden ocultar", () => {
    const design: TicketDesign = {
      ...DEFAULT_TICKET,
      headerText: "Tel. 910 000 000\nwww.barpepe.es",
      footer: "¡Gracias!\nVuelve pronto",
      showTable: false,
    };
    const t = texts(receipt(sampleInput(design)));
    expect(t).toEqual(
      expect.arrayContaining(["Bar Pepe", "BAR PEPE SL", "NIF B76543214", "Tel. 910 000 000", "www.barpepe.es", "Ana", "¡Gracias!", "Vuelve pronto"]),
    );
    expect(t.join("|")).not.toContain("Mesa 4");

    const noOne = texts(receipt(sampleInput({ ...design, showWaiter: false })));
    expect(noOne.join("|")).not.toContain("Ana");
  });

  it("con logo se puede ocultar el nombre comercial, pero nunca la razón social ni el NIF", () => {
    const doc = receipt(sampleInput({ ...DEFAULT_TICKET, showTradeName: false, logo: LOGO }));
    expect(doc.blocks[0]).toEqual({ t: "image", logo: LOGO });
    const t = texts(doc);
    expect(t).not.toContain("Bar Pepe");
    expect(t).toEqual(expect.arrayContaining(["BAR PEPE SL", "NIF B76543214"]));

    // Sin logo, el nombre sale aunque se haya pedido ocultarlo
    expect(texts(receipt(sampleInput({ ...DEFAULT_TICKET, showTradeName: false })))).toContain("Bar Pepe");
    // La cuenta previa usa la misma cabecera
    const b = bill({ business, design: { ...DEFAULT_TICKET, logo: LOGO }, tableLabel: "Sala · Mesa 1", at: new Date(), lines: [], totalCents: 0, paidCents: 0 });
    expect(b.blocks[0]).toEqual({ t: "image", logo: LOGO });
  });

  it("el documento guardado solo lleva la referencia al logo (se puede reimprimir en JSON)", () => {
    const json = JSON.stringify(receipt(sampleInput({ ...DEFAULT_TICKET, logo: LOGO })));
    expect(json.length).toBeLessThan(3000);
  });

  it("tramado y umbral: pasa a 1 bit lo negro y deja en blanco lo blanco", () => {
    const img = resize(decodePng(halfBlackPng()), 96);
    expect(img.height).toBe(38);
    for (const style of ["THRESHOLD", "DITHER"] as const) {
      const bmp = toBitmap(img, style);
      expect(bmp.width).toBe(96);
      // Fila 10: 48 píxeles negros (6 bytes 0xFF) y 48 blancos
      const row = [...bmp.bits.subarray(10 * 12, 11 * 12)];
      expect(row).toEqual([255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0]);
    }
    // Un gris medio con tramado sale aproximadamente al 50 %
    const grey = toBitmap({ width: 64, height: 64, gray: new Uint8Array(64 * 64).fill(128) }, "DITHER");
    const black = [...grey.bits].reduce((n, b) => n + b.toString(2).split("1").length - 1, 0);
    expect(black / (64 * 64)).toBeGreaterThan(0.4);
    expect(black / (64 * 64)).toBeLessThan(0.6);
  });

  it("ESC/POS: el logo va como imagen de trama centrada, al tamaño pedido del papel", async () => {
    const doc = await resolveImages(receipt(sampleInput({ ...DEFAULT_TICKET, logo: LOGO })));
    const bytes = toEscPos(doc, 80);
    // 60 % de 576 puntos = 345,6 → 344 (múltiplo de 8) = 43 bytes por fila; 80·344/200 = 138 filas
    const gsv0 = (rows: number) => Buffer.from([0x1d, 0x76, 0x30, 0x00, 43, 0, rows, 0]);
    const first = bytes.indexOf(gsv0(128));
    expect(first).toBeGreaterThan(0);
    expect(bytes.subarray(first - 3, first)).toEqual(Buffer.from([0x1b, 0x61, 1]));
    expect(bytes.indexOf(gsv0(10), first + 8 + 43 * 128)).toBe(first + 8 + 43 * 128);

    // En 58 mm se ajusta a 384 puntos
    expect(toEscPos(doc, 58).indexOf(Buffer.from([0x1d, 0x76, 0x30, 0x00, 29, 0]))).toBeGreaterThan(0);
  });

  it("HTML (impresoras USB): el logo va incrustado y al ancho proporcional", async () => {
    const doc = await resolveImages(receipt(sampleInput({ ...DEFAULT_TICKET, logo: LOGO })));
    const html = await toHtml(doc, 80);
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain("width:45.6mm");
  });

  it("si el logo aún no se ha descargado, el ticket sale igual sin él", async () => {
    const doc = await resolveImages(receipt(sampleInput({ ...DEFAULT_TICKET, logo: { ...LOGO, hash: "otro" } })));
    expect(doc.blocks.some((b) => b.t === "image")).toBe(false);
  });

  it("los ajustes guardados antes del diseño conservan su pie de ticket", async () => {
    await prisma.localSettings.upsert({
      where: { id: 1 },
      create: { id: 1, json: JSON.stringify({ business: { ...business, ticketFooter: "Pie antiguo" } }) },
      update: { json: JSON.stringify({ business: { ...business, ticketFooter: "Pie antiguo" } }) },
    });
    expect((await getSettings()).ticket).toEqual({ ...DEFAULT_TICKET, footer: "Pie antiguo" });
  });

  it("imprime el ticket de prueba con el diseño en la impresora de tickets", async () => {
    const jobs: Buffer[] = [];
    const srv = net.createServer((s) => {
      const chunks: Buffer[] = [];
      s.on("data", (c) => chunks.push(c));
      s.on("end", () => jobs.push(Buffer.concat(chunks)));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const printer = await prisma.printer.create({
      data: { name: "Tickets prueba", type: "NETWORK", address: "127.0.0.1", port: (srv.address() as AddressInfo).port },
    });
    try {
      expect((await printSampleReceipt()).ok).toBe(false);
      await saveSettings(prisma, {
        ...DEFAULT_SETTINGS,
        receiptPrinterId: printer.id,
        business,
        ticket: { ...DEFAULT_TICKET, footer: "Pie nuevo", logo: LOGO },
        verifactu: { enabled: true, environment: "TEST", endDate: null },
      });
      expect(await printSampleReceipt()).toEqual({ ok: true, printerName: "Tickets prueba" });
      await new Promise((r) => setTimeout(r, 100));
      const out = jobs[0].toString("latin1");
      expect(out).toContain("*** TICKET DE PRUEBA ***");
      expect(out).toContain("QR tributario");
      expect(out).toContain("Pie nuevo");
      expect(jobs[0].indexOf(Buffer.from([0x1d, 0x76, 0x30]))).toBeGreaterThan(0);
    } finally {
      await prisma.printJob.deleteMany({ where: { printerId: printer.id } });
      await prisma.printer.delete({ where: { id: printer.id } });
      srv.close();
    }
  });
});
