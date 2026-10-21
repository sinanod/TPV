import { prisma } from "../db";
import { paidQtyByLine } from "../billing";

const OPEN_STATUSES = ["OPEN", "SENT", "SERVED"];
const toCents = (n: number) => Math.round(n * 100);

export async function enqueue(key: string, type: string, data: unknown) {
  await prisma.$transaction([
    prisma.outboxEvent.deleteMany({ where: { key } }),
    prisma.outboxEvent.create({ data: { key, type, data: JSON.stringify(data), at: new Date() } }),
  ]);
}

/** Las mesas que no vienen del portal (creadas antes de vincular) no se sincronizan. */
export async function enqueueTable(tableId: number) {
  const table = await prisma.table.findUnique({ where: { id: tableId } });
  if (!table?.cloudId) return false;
  await enqueue(`table:${table.id}`, "table.status", { tableId: table.cloudId, status: table.status });
  return true;
}

function paymentPayload(p: {
  items?: { orderLineId: number; qty: number }[];
  uuid: string;
  method: string;
  amount: number;
  tendered: number | null;
  refundAmount: number;
  onlinePaymentId: string | null;
  createdAt: Date;
}) {
  return {
    uuid: p.uuid,
    method: p.method,
    amountCents: toCents(p.amount),
    tenderedCents: p.tendered === null ? null : toCents(p.tendered),
    refundCents: toCents(p.refundAmount),
    onlinePaymentId: p.onlinePaymentId,
    createdAt: p.createdAt.toISOString(),
    items: (p.items ?? []).map((i) => ({ lineId: i.orderLineId, qty: i.qty })),
  };
}

export async function enqueueOrder(orderId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      table: { include: { zone: true } },
      waiter: true,
      lines: { include: { product: true }, orderBy: { createdAt: "asc" } },
      payments: { orderBy: { createdAt: "asc" }, include: { items: true } },
      invoice: true,
    },
  });
  if (!order) return false;
  const paidQty = paidQtyByLine(order.payments);

  await enqueue(`order:${order.uuid}`, "order.upsert", {
    localUuid: order.uuid,
    tableId: order.table.cloudId,
    tableLabel: `${order.table.zone.name} · Mesa ${order.table.number}`,
    waiterName: order.waiter.name,
    status: order.status,
    paymentMethod: order.paymentMethod,
    total: order.lines.reduce((s, l) => s + toCents(l.qty * l.unitPrice), 0) / 100,
    openedAt: order.createdAt.toISOString(),
    closedAt: order.closedAt?.toISOString() ?? null,
    invoiceNumber: order.invoice?.numSerie ?? null,
    lines: order.lines.map((l) => ({
      // Para que el cliente pueda elegir qué paga desde el QR de la mesa
      localId: l.id,
      paidQty: paidQty.get(l.id) ?? 0,
      productId: l.product.cloudId,
      productName: l.product.name,
      qty: l.qty,
      unitPrice: l.unitPrice,
      note: l.note,
      status: l.status,
    })),
    payments: order.payments.map(paymentPayload),
  });
  return true;
}

/**
 * Factura emitida. El registro VERI*FACTU viaja tal cual se generó (XML,
 * huella y QR): la nube lo remite a la AEAT sin regenerarlo. Nunca se
 * deduplica con otros eventos, y la cola respeta el orden de la cadena.
 */
export async function enqueueInvoice(invoiceId: number) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      order: {
        include: {
          table: { include: { zone: true } },
          waiter: true,
          lines: { include: { product: true }, orderBy: { createdAt: "asc" } },
          payments: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  const o = invoice.order;
  const emails = [...new Set(o.payments.map((p) => p.email?.trim().toLowerCase()).filter((e): e is string => !!e))];

  await enqueue(`invoice:${invoice.uuid}`, "invoice.issued", {
    uuid: invoice.uuid,
    orderUuid: o.uuid,
    numSerie: invoice.numSerie,
    issuedAt: invoice.issuedAt.toISOString(),
    issueDate: invoice.issueDate,
    totalCents: invoice.totalCents,
    taxCents: invoice.taxCents,
    breakdown: JSON.parse(invoice.breakdown),
    tableLabel: `${o.table.zone.name} · Mesa ${o.table.number}`,
    waiterName: o.waiter.name,
    lines: o.lines.map((l) => ({
      name: l.product.name,
      qty: l.qty,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
      totalCents: toCents(l.qty * l.unitPrice),
    })),
    payments: o.payments.map(paymentPayload),
    emails,
    verifactu:
      invoice.chainSeq === null
        ? null
        : {
            chainSeq: invoice.chainSeq,
            issuerNif: invoice.issuerNif,
            hash: invoice.hash,
            recordXml: invoice.recordXml,
            qrUrl: invoice.qrUrl,
            environment: invoice.environment,
          },
  });
}

/** El cliente pide el ticket por email después de cobrar. */
export async function enqueueInvoiceEmail(invoiceUuid: string, email: string) {
  await enqueue(`invoice-email:${invoiceUuid}:${email}`, "invoice.email", { invoiceUuid, email });
}

export async function enqueuePaymentApplied(data: {
  onlinePaymentId: string;
  result: "APPLIED" | "REFUND_REQUIRED" | "ORDER_NOT_FOUND";
  refundCents: number;
  localPaymentUuid: string | null;
}) {
  await enqueue(`online-payment:${data.onlinePaymentId}`, "payment.applied", data);
}

/** Impresoras instaladas en el PC: el portal las ofrece al configurar impresoras USB. */
export async function enqueueDevicePrinters(names: string[]) {
  await enqueue("device:printers", "device.printers", { systemPrinters: names });
}

/** Estado actual completo: se reenvía en cada reconexión para que la nube converja. */
export async function enqueueSnapshot() {
  const tables = await prisma.table.findMany({ where: { active: true, cloudId: { not: null } } });
  for (const t of tables) await enqueueTable(t.id);
  const openOrders = await prisma.order.findMany({ where: { status: { in: OPEN_STATUSES } } });
  for (const o of openOrders) await enqueueOrder(o.id);
}
