import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./http";
import { getSettings, Settings, verifactuActive } from "./settings";
import {
  buildRegistroAlta,
  formatInvoiceDate,
  qrUrl,
  SIMPLIFIED_INVOICE_LIMIT_CENTS,
  taxBreakdown,
} from "./fiscal/verifactu";

type Tx = Prisma.TransactionClient;

export const OPEN_STATUSES = ["OPEN", "SENT", "SERVED"];
export const toCents = (euros: number) => Math.round(euros * 100);

export function orderTotals(order: {
  lines: { qty: number; unitPrice: number }[];
  payments: { amount: number }[];
}) {
  const totalCents = order.lines.reduce((s, l) => s + toCents(l.qty * l.unitPrice), 0);
  const paidCents = order.payments.reduce((s, p) => s + toCents(p.amount), 0);
  return { totalCents, paidCents, pendingCents: totalCents - paidCents };
}

/** Unidades ya pagadas de cada línea en cobros por artículos. */
export function paidQtyByLine(payments: { items?: { orderLineId: number; qty: number }[] }[]) {
  const paid = new Map<number, number>();
  for (const p of payments) for (const i of p.items ?? []) paid.set(i.orderLineId, (paid.get(i.orderLineId) ?? 0) + i.qty);
  return paid;
}

export interface PaymentItemInput {
  lineId: number;
  qty: number;
}

// Cobros y facturas de una en una: la serie de numeración y la cadena de
// huellas VERI*FACTU no admiten dos registros con el mismo "anterior".
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

function paymentSummary(methods: string[]) {
  const distinct = [...new Set(methods)];
  return distinct.length === 1 ? distinct[0] : "MIXED";
}

function assertCanIssueVerifactu(settings: Settings) {
  if (!settings.business?.nif || !settings.business.legalName || !settings.sif) {
    throw new HttpError(409, "VERI*FACTU está activado pero faltan los datos fiscales: revísalos en el portal");
  }
}

/** Emite la factura simplificada de una comanda totalmente pagada y la cierra. */
async function issueInvoice(tx: Tx, orderId: number) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { lines: true, payments: true },
  });
  const settings = await getSettings(tx);
  const issuedAt = new Date();

  const breakdown = taxBreakdown(order.lines.map((l) => ({ grossCents: toCents(l.qty * l.unitPrice), taxRate: l.taxRate })));
  const totalCents = breakdown.reduce((s, b) => s + b.baseCents + b.quotaCents, 0);
  const taxCents = breakdown.reduce((s, b) => s + b.quotaCents, 0);

  const series = `${settings.invoiceSeries}-${issuedAt.getFullYear()}`;
  const last = await tx.invoice.findFirst({ where: { series }, orderBy: { number: "desc" } });
  const number = (last?.number ?? 0) + 1;
  const numSerie = `${series}-${String(number).padStart(6, "0")}`;

  let verifactu: Partial<Prisma.InvoiceUncheckedCreateInput> = {};
  if (verifactuActive(settings, issuedAt)) {
    assertCanIssueVerifactu(settings);
    const business = settings.business!;
    const previous = await tx.invoice.findFirst({ where: { chainSeq: { not: null } }, orderBy: { chainSeq: "desc" } });
    const record = buildRegistroAlta({
      issuerNif: business.nif,
      issuerName: business.legalName,
      numSerie,
      issuedAt,
      generatedAt: issuedAt,
      description: "Servicio de restauración",
      breakdown,
      previous: previous
        ? { nif: previous.issuerNif!, numSerie: previous.numSerie, issueDate: previous.issueDate, hash: previous.hash! }
        : null,
      sif: { ...settings.sif!, installationNumber: settings.installationNumber },
    });
    verifactu = {
      chainSeq: (previous?.chainSeq ?? 0) + 1,
      issuerNif: business.nif,
      hash: record.hash,
      recordXml: record.xml,
      qrUrl: qrUrl(settings.verifactu.environment, business.nif, numSerie, issuedAt, totalCents),
      environment: settings.verifactu.environment,
    };
  }

  const invoice = await tx.invoice.create({
    data: {
      orderId,
      series,
      number,
      numSerie,
      issuedAt,
      issueDate: formatInvoiceDate(issuedAt),
      totalCents,
      taxCents,
      breakdown: JSON.stringify(breakdown),
      ...verifactu,
    },
  });
  await tx.order.update({
    where: { id: orderId },
    data: {
      status: "PAID",
      closedAt: issuedAt,
      paymentMethod: paymentSummary(order.payments.filter((p) => p.amount > 0).map((p) => p.method)),
    },
  });
  await tx.table.update({ where: { id: order.tableId }, data: { status: "FREE" } });
  return invoice;
}

export interface PaymentInput {
  method: "CASH" | "CARD" | "ONLINE";
  /** Importe a aplicar; por defecto, todo lo pendiente */
  amountCents?: number;
  /** Solo efectivo: lo que entrega el cliente */
  tenderedCents?: number;
  email?: string | null;
  waiterId?: number | null;
  onlinePaymentId?: string;
  /**
   * Cobro por artículos: el importe es lo que valen (o lo pendiente, si es
   * menos). En un pago online el importe es el que pagó el cliente y los
   * artículos que ya se hayan cobrado por otro lado se ignoran.
   */
  items?: PaymentItemInput[];
}

export interface PaymentResult {
  orderId: number;
  tableId: number;
  paymentId: number;
  changeCents: number;
  refundCents: number;
  invoiceId: number | null;
  /** El pago online ya estaba aplicado (reintento) */
  duplicate: boolean;
}

export function registerPayment(orderId: number, input: PaymentInput): Promise<PaymentResult> {
  return serialized(() =>
    prisma.$transaction(
      async (tx) => {
        if (input.onlinePaymentId) {
          const existing = await tx.payment.findUnique({ where: { onlinePaymentId: input.onlinePaymentId } });
          if (existing) {
            const order = await tx.order.findUniqueOrThrow({ where: { id: existing.orderId }, include: { invoice: true } });
            return {
              orderId: order.id,
              tableId: order.tableId,
              paymentId: existing.id,
              changeCents: 0,
              refundCents: toCents(existing.refundAmount),
              invoiceId: order.invoice?.id ?? null,
              duplicate: true,
            };
          }
        }

        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: { lines: true, payments: { include: { items: true } } },
        });
        if (!order) throw new HttpError(404, "Comanda no encontrada");
        const { totalCents, pendingCents } = orderTotals(order);
        const isOpen = OPEN_STATUSES.includes(order.status);
        const base = {
          orderId,
          method: input.method,
          email: input.email || null,
          waiterId: input.waiterId ?? null,
          onlinePaymentId: input.onlinePaymentId,
        };

        // Un pago online puede llegar con la mesa ya cobrada por el camarero:
        // no se pierde, queda registrado para devolverlo.
        if (!isOpen || pendingCents <= 0) {
          if (input.method !== "ONLINE") throw new HttpError(409, "Esta cuenta ya está cobrada");
          const refundCents = input.amountCents ?? 0;
          const payment = await tx.payment.create({ data: { ...base, amount: 0, refundAmount: refundCents / 100 } });
          return { orderId, tableId: order.tableId, paymentId: payment.id, changeCents: 0, refundCents, invoiceId: null, duplicate: false };
        }

        // Artículos elegidos: se comprueba que sean de esta cuenta y que queden sin pagar
        const items: PaymentItemInput[] = [];
        let itemsCents = 0;
        if (input.items) {
          const paid = paidQtyByLine(order.payments);
          const lines = new Map(order.lines.map((l) => [l.id, l]));
          const wanted = new Map<number, number>();
          for (const i of input.items) {
            if (!Number.isInteger(i.qty) || i.qty <= 0) throw new HttpError(400, "Cantidad de artículos no válida");
            if (!lines.has(i.lineId)) throw new HttpError(400, "Ese artículo no es de esta cuenta");
            wanted.set(i.lineId, (wanted.get(i.lineId) ?? 0) + i.qty);
          }
          for (const [lineId, qty] of wanted) {
            const line = lines.get(lineId)!;
            const available = line.qty - (paid.get(lineId) ?? 0);
            const take = input.method === "ONLINE" ? Math.min(qty, available) : qty;
            if (take > available) {
              throw new HttpError(409, available > 0 ? `Solo quedan ${available} sin pagar de ese artículo` : "Ese artículo ya está pagado");
            }
            if (take > 0) {
              items.push({ lineId, qty: take });
              itemsCents += toCents(line.unitPrice) * take;
            }
          }
          if (!items.length && input.method !== "ONLINE") throw new HttpError(400, "Elige al menos un artículo");
        }

        let amountCents =
          input.items && input.method !== "ONLINE"
            ? // Si antes se cobró algo por importe, lo pendiente puede ser menos que lo que valen
              Math.min(itemsCents, pendingCents)
            : (input.amountCents ?? pendingCents);
        if (!Number.isInteger(amountCents) || amountCents <= 0) throw new HttpError(400, "El importe debe ser mayor que cero");

        let changeCents = 0;
        let refundCents = 0;
        if (amountCents > pendingCents) {
          if (input.method === "CASH") changeCents = amountCents - pendingCents;
          else if (input.method === "ONLINE") refundCents = amountCents - pendingCents;
          else throw new HttpError(400, "El importe con tarjeta no puede superar lo pendiente");
          amountCents = pendingCents;
        }

        let tenderedCents: number | null = changeCents ? amountCents + changeCents : null;
        if (input.method === "CASH" && input.tenderedCents !== undefined) {
          if (input.tenderedCents < amountCents) throw new HttpError(400, "El efectivo entregado no cubre el importe");
          tenderedCents = input.tenderedCents;
          changeCents = input.tenderedCents - amountCents;
        }

        const isFinalPayment = amountCents === pendingCents;
        if (isFinalPayment && totalCents > SIMPLIFIED_INVOICE_LIMIT_CENTS) {
          throw new HttpError(
            409,
            "La cuenta supera 3.000 €: la ley exige factura completa con los datos del cliente (aún no disponible en este TPV)",
          );
        }

        const payment = await tx.payment.create({
          data: {
            ...base,
            amount: amountCents / 100,
            tendered: tenderedCents === null ? null : tenderedCents / 100,
            refundAmount: refundCents / 100,
            items: { create: items.map((i) => ({ orderLineId: i.lineId, qty: i.qty })) },
          },
        });
        const invoice = isFinalPayment ? await issueInvoice(tx, orderId) : null;
        return {
          orderId,
          tableId: order.tableId,
          paymentId: payment.id,
          changeCents,
          refundCents,
          invoiceId: invoice?.id ?? null,
          duplicate: false,
        };
      },
      { timeout: 20_000 },
    ),
  );
}

/** Mesa abierta sin consumir: se libera sin factura. */
export function cancelEmptyOrder(orderId: number) {
  return serialized(() =>
    prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { lines: true, payments: true } });
      if (!order) throw new HttpError(404, "Comanda no encontrada");
      if (order.lines.length || order.payments.length) throw new HttpError(409, "La comanda tiene productos o pagos");
      await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED", closedAt: new Date() } });
      await tx.table.update({ where: { id: order.tableId }, data: { status: "FREE" } });
      return order;
    }),
  );
}
