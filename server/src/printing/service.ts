import { Printer } from "@prisma/client";
import { prisma } from "../db";
import { emitEvent } from "../realtime";
import { getSettings } from "../settings";
import { bill, kitchenTicket, PrintDocument, receipt, testPage } from "./document";
import { toEscPos } from "./escpos";
import { toHtml } from "./html";
import { sendRaw } from "./network";
import { printWithAgent } from "./agent";

export interface PrintResult {
  jobId: number;
  printerName: string;
  ok: boolean;
  error: string | null;
}

async function send(printer: Printer, doc: PrintDocument) {
  if (printer.type === "SYSTEM") {
    await printWithAgent(printer.address, await toHtml(doc, printer.width), printer.width);
  } else {
    await sendRaw(printer.address, printer.port, toEscPos(doc, printer.width));
  }
}

async function runJob(jobId: number): Promise<PrintResult> {
  const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId }, include: { printer: true } });
  const printerName = job.printer?.name ?? "—";
  try {
    if (!job.printer) throw new Error("La impresora ya no existe");
    await send(job.printer, JSON.parse(job.document) as PrintDocument);
    await prisma.printJob.update({
      where: { id: jobId },
      data: { status: "DONE", error: null, attempts: { increment: 1 } },
    });
    return { jobId, printerName, ok: true, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.printJob.update({ where: { id: jobId }, data: { status: "ERROR", error, attempts: { increment: 1 } } });
    // El TPV avisa en pantalla: una comanda sin imprimir en cocina es un plato que no sale.
    emitEvent("print:failed", { jobId, printerName, title: job.title, error });
    return { jobId, printerName, ok: false, error };
  }
}

async function print(printer: Printer, kind: string, title: string, doc: PrintDocument) {
  const job = await prisma.printJob.create({
    data: { printerId: printer.id, kind, title, document: JSON.stringify(doc) },
  });
  return runJob(job.id);
}

export function retryPrintJob(jobId: number) {
  return runJob(jobId);
}

const lineTotalCents = (l: { qty: number; unitPrice: number }) => Math.round(l.qty * l.unitPrice * 100);
const tableLabel = (t: { number: number; zone: { name: string } }) => `${t.zone.name} · Mesa ${t.number}`;

/** Imprime en cada impresora las líneas de las familias que tiene asignadas. */
export async function printKitchenTickets(orderId: number, lineIds: number[]): Promise<PrintResult[]> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      table: { include: { zone: true } },
      waiter: true,
      lines: {
        where: { id: { in: lineIds } },
        orderBy: { createdAt: "asc" },
        include: { product: { include: { category: { include: { printer: true } } } } },
      },
    },
  });

  const byPrinter = new Map<number, { printer: Printer; lines: typeof order.lines }>();
  for (const line of order.lines) {
    const printer = line.product.category.printer;
    if (!printer?.active) continue;
    const group = byPrinter.get(printer.id) ?? { printer, lines: [] };
    group.lines.push(line);
    byPrinter.set(printer.id, group);
  }

  return Promise.all(
    [...byPrinter.values()].map(({ printer, lines }) =>
      print(
        printer,
        "KITCHEN",
        `Comanda ${tableLabel(order.table)}`,
        kitchenTicket({
          printerName: printer.name,
          tableLabel: tableLabel(order.table),
          waiterName: order.waiter.name,
          at: new Date(),
          lines: lines.map((l) => ({ qty: l.qty, name: l.product.name, note: l.note })),
        }),
      ),
    ),
  );
}

async function receiptPrinter() {
  const { receiptPrinterId } = await getSettings();
  if (!receiptPrinterId) return null;
  return prisma.printer.findFirst({ where: { id: receiptPrinterId, active: true } });
}

/** Ticket (factura simplificada) en la impresora de tickets. Null si no hay ninguna configurada. */
export async function printReceipt(invoiceId: number): Promise<PrintResult | null> {
  const printer = await receiptPrinter();
  if (!printer) return null;
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      order: {
        include: {
          table: { include: { zone: true } },
          waiter: true,
          lines: { orderBy: { createdAt: "asc" }, include: { product: true } },
          payments: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  const { business } = await getSettings();
  const o = invoice.order;
  return print(
    printer,
    "RECEIPT",
    `Ticket ${invoice.numSerie}`,
    receipt({
      business,
      numSerie: invoice.numSerie,
      issuedAt: invoice.issuedAt,
      tableLabel: tableLabel(o.table),
      waiterName: o.waiter.name,
      lines: o.lines.map((l) => ({ qty: l.qty, name: l.product.name, totalCents: lineTotalCents(l) })),
      breakdown: JSON.parse(invoice.breakdown),
      totalCents: invoice.totalCents,
      payments: o.payments
        .filter((p) => p.amount > 0)
        .map((p) => ({
          method: p.method,
          amountCents: Math.round(p.amount * 100),
          tenderedCents: p.tendered === null ? null : Math.round(p.tendered * 100),
        })),
      qrUrl: invoice.qrUrl,
    }),
  );
}

export async function printBill(orderId: number): Promise<PrintResult | null> {
  const printer = await receiptPrinter();
  if (!printer) return null;
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      table: { include: { zone: true } },
      lines: { orderBy: { createdAt: "asc" }, include: { product: true } },
      payments: true,
    },
  });
  const { business } = await getSettings();
  const lines = order.lines.map((l) => ({ qty: l.qty, name: l.product.name, totalCents: lineTotalCents(l) }));
  return print(
    printer,
    "BILL",
    `Cuenta ${tableLabel(order.table)}`,
    bill({
      business,
      tableLabel: tableLabel(order.table),
      at: new Date(),
      lines,
      totalCents: lines.reduce((s, l) => s + l.totalCents, 0),
      paidCents: order.payments.reduce((s, p) => s + Math.round(p.amount * 100), 0),
    }),
  );
}

export async function printTestPage(printerId: number): Promise<PrintResult> {
  const printer = await prisma.printer.findUniqueOrThrow({ where: { id: printerId } });
  return print(printer, "TEST", `Prueba ${printer.name}`, testPage(printer.name));
}
