import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db";
import { h, HttpError } from "../lib/http";
import { publicBaseUrl } from "../lib/urls";
import { getPaymentProvider } from "../payments/providers";
import { emitToDevices, emitToPortal } from "../realtime";

// Páginas del cliente en la mesa (sin login): el token del QR identifica la
// mesa. Solo se puede ver la cuenta abierta de esa mesa y pagarla.
export const publicRouter = Router();

publicRouter.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Demasiadas peticiones. Espera un momento." },
  }),
);

const OPEN_STATUSES = ["OPEN", "SENT", "SERVED"];

const PUBLIC_SETTINGS = { tradeName: true, onlinePaymentsEnabled: true, ticketLogoHash: true } as const;

async function tableByToken(token: string) {
  const table = await prisma.diningTable.findUnique({
    where: { qrToken: token },
    // Solo lo que necesitan estas páginas: ni el logo (se sirve aparte) ni el certificado
    include: { zone: true, tenant: { include: { settings: { select: PUBLIC_SETTINGS } } } },
  });
  if (!table || !table.tenant.active) throw new HttpError(404, "Este código QR no corresponde a ninguna mesa");
  return table;
}

type PaidItem = { lineId: number; qty: number };
const asItems = (json: unknown): PaidItem[] => (Array.isArray(json) ? (json as PaidItem[]) : []);

/**
 * Cuenta abierta de la mesa con lo pendiente, descontando pagos online aún no
 * registrados por el TPV (también sus artículos, para no ofrecerlos dos veces).
 */
async function openBill(tableId: string) {
  const order = await prisma.order.findFirst({
    where: { tableId, status: { in: OPEN_STATUSES } },
    orderBy: { openedAt: "desc" },
    include: { lines: { orderBy: { localId: "asc" } }, payments: true },
  });
  if (!order) return null;
  const inFlight = await prisma.onlinePayment.findMany({
    where: { orderLocalUuid: order.localUuid, status: "SUCCEEDED", appliedAt: null },
    select: { amountCents: true, items: true },
  });
  const inFlightQty = new Map<number, number>();
  for (const p of inFlight) for (const i of asItems(p.items)) inFlightQty.set(i.lineId, (inFlightQty.get(i.lineId) ?? 0) + i.qty);

  const totalCents = Math.round(order.total * 100);
  const paidCents =
    order.payments.reduce((s, p) => s + p.amountCents, 0) + inFlight.reduce((s, p) => s + p.amountCents, 0);
  const pendingCents = Math.max(totalCents - paidCents, 0);
  return {
    order,
    view: {
      lines: order.lines.map((l) => {
        const unitCents = Math.round(l.unitPrice * 100);
        const paidQty = Math.min(l.qty, l.paidQty + (l.localId !== null ? (inFlightQty.get(l.localId) ?? 0) : 0));
        return {
          // Sin id (TPV antiguo) la línea no se puede elegir por separado
          lineId: l.localId,
          name: l.productName,
          qty: l.qty,
          unitCents,
          totalCents: Math.round(l.qty * l.unitPrice * 100),
          // Con la cuenta ya pagada del todo no queda nada por elegir
          availableQty: pendingCents > 0 ? l.qty - paidQty : 0,
        };
      }),
      totalCents,
      paidCents,
      pendingCents,
    },
  };
}

publicRouter.get(
  "/tables/:token",
  h(async (req, res) => {
    const table = await tableByToken(req.params.token);
    const s = table.tenant.settings;
    const bill = await openBill(table.id);
    const provider = getPaymentProvider();
    res.json({
      restaurant: s?.tradeName || table.tenant.name,
      table: `${table.zone.name} · Mesa ${table.number}`,
      onlinePayments: { enabled: !!(s?.onlinePaymentsEnabled && provider), demo: provider?.name === "demo" },
      logoUrl: s?.ticketLogoHash ? `/api/public/tables/${table.qrToken}/logo?v=${s.ticketLogoHash}` : null,
      bill: bill?.view ?? null,
    });
  }),
);

// El mismo logo del ticket, para la página de la mesa
publicRouter.get(
  "/tables/:token/logo",
  h(async (req, res) => {
    const table = await tableByToken(req.params.token);
    const logo = (await prisma.tenantSettings.findUnique({ where: { tenantId: table.tenantId }, select: { ticketLogo: true } }))
      ?.ticketLogo;
    if (!logo) throw new HttpError(404, "Sin logo");
    res.set({ "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
    res.send(Buffer.from(logo));
  }),
);

const paySchema = z
  .object({
    amountCents: z.number().int().positive().optional(),
    /** Pagar artículos concretos: el importe lo calcula el servidor */
    items: z
      .array(z.object({ lineId: z.number().int(), qty: z.number().int().positive() }))
      .min(1)
      .max(100)
      .optional(),
    email: z.string().trim().email().optional().or(z.literal("")),
  })
  .refine((d) => d.amountCents !== undefined || d.items !== undefined, "Indica el importe o los artículos");

publicRouter.post(
  "/tables/:token/payments",
  h(async (req, res) => {
    const body = paySchema.parse(req.body);
    const { email } = body;
    const table = await tableByToken(req.params.token);
    const provider = getPaymentProvider();
    if (!table.tenant.settings?.onlinePaymentsEnabled || !provider) {
      throw new HttpError(409, "Este restaurante no acepta pagos desde el móvil");
    }
    const bill = await openBill(table.id);
    if (!bill || bill.view.pendingCents <= 0) throw new HttpError(409, "No hay nada pendiente de pagar en esta mesa");

    let amountCents = body.amountCents ?? 0;
    let items: PaidItem[] | null = null;
    if (body.items) {
      const lines = new Map(bill.view.lines.filter((l) => l.lineId !== null).map((l) => [l.lineId!, l]));
      const wanted = new Map<number, number>();
      for (const i of body.items) wanted.set(i.lineId, (wanted.get(i.lineId) ?? 0) + i.qty);
      items = [];
      let itemsCents = 0;
      for (const [lineId, qty] of wanted) {
        const line = lines.get(lineId);
        if (!line) throw new HttpError(400, "Ese artículo no está en la cuenta");
        if (qty > line.availableQty) {
          throw new HttpError(409, `«${line.name}» ya está pagado (o alguien lo está pagando): recarga la cuenta`);
        }
        items.push({ lineId, qty });
        itemsCents += line.unitCents * qty;
      }
      // Si antes se pagó una parte por importe, lo pendiente puede ser menos
      amountCents = Math.min(itemsCents, bill.view.pendingCents);
      if (amountCents <= 0) throw new HttpError(400, "Esos artículos no tienen importe que pagar");
    } else if (amountCents > bill.view.pendingCents) {
      throw new HttpError(400, "El importe supera lo pendiente de la cuenta");
    }

    const payment = await prisma.onlinePayment.create({
      data: {
        tenantId: table.tenantId,
        tableId: table.id,
        orderLocalUuid: bill.order.localUuid,
        amountCents,
        items: items ?? undefined,
        email: email ? email.toLowerCase() : null,
        provider: provider.name,
      },
    });
    const base = publicBaseUrl(req);
    const checkout = await provider.createCheckout({
      paymentId: payment.id,
      amountCents,
      description: `${table.tenant.settings?.tradeName || table.tenant.name} · ${table.zone.name} mesa ${table.number}`,
      returnUrl: `${base}/m/${table.qrToken}?pago=${payment.id}`,
    });
    if (checkout.providerRef) {
      await prisma.onlinePayment.update({ where: { id: payment.id }, data: { providerRef: checkout.providerRef } });
    }
    res.status(201).json({ paymentId: payment.id, amountCents, redirectUrl: checkout.redirectUrl });
  }),
);

publicRouter.get(
  "/payments/:id",
  h(async (req, res) => {
    const payment = await prisma.onlinePayment.findUnique({
      where: { id: req.params.id },
      include: { table: { include: { zone: true } }, tenant: { include: { settings: { select: PUBLIC_SETTINGS } } } },
    });
    if (!payment) throw new HttpError(404, "Pago no encontrado");

    // Cuando el TPV cierra la cuenta, el ticket se envía al email del pago
    let receipt: { status: string } | null = null;
    if (payment.email) {
      const invoice = await prisma.invoice.findFirst({
        where: { tenantId: payment.tenantId, orderLocalUuid: payment.orderLocalUuid },
        include: { emails: { where: { to: payment.email } } },
      });
      receipt = invoice?.emails[0] ? { status: invoice.emails[0].status } : null;
    }
    res.json({
      id: payment.id,
      status: payment.status,
      amountCents: payment.amountCents,
      restaurant: payment.tenant.settings?.tradeName || payment.tenant.name,
      table: `${payment.table.zone.name} · Mesa ${payment.table.number}`,
      tableToken: payment.table.qrToken,
      email: payment.email,
      registeredByRestaurant: !!payment.appliedAt,
      refundCents: payment.refundCents,
      receipt,
      demo: payment.provider === "demo",
    });
  }),
);

/** Lo llama la pasarela (o el modo demo) cuando el cobro se ha completado. */
export async function markOnlinePaymentSucceeded(paymentId: string) {
  const result = await prisma.onlinePayment.updateMany({
    where: { id: paymentId, status: "CREATED" },
    data: { status: "SUCCEEDED", paidAt: new Date() },
  });
  if (!result.count) return false;
  const payment = await prisma.onlinePayment.findUniqueOrThrow({ where: { id: paymentId } });
  emitToDevices(payment.tenantId, "payments:pending");
  emitToPortal(payment.tenantId, "live:updated");
  return true;
}

function requireDemo(provider: string) {
  if (provider !== "demo" || getPaymentProvider()?.name !== "demo") throw new HttpError(404, "Pago no encontrado");
}

publicRouter.post(
  "/payments/:id/demo/confirm",
  h(async (req, res) => {
    const payment = await prisma.onlinePayment.findUnique({ where: { id: req.params.id } });
    if (!payment) throw new HttpError(404, "Pago no encontrado");
    requireDemo(payment.provider);
    if (!(await markOnlinePaymentSucceeded(payment.id))) throw new HttpError(409, "Este pago ya no se puede completar");
    res.json({ ok: true });
  }),
);

publicRouter.post(
  "/payments/:id/demo/cancel",
  h(async (req, res) => {
    const payment = await prisma.onlinePayment.findUnique({ where: { id: req.params.id } });
    if (!payment) throw new HttpError(404, "Pago no encontrado");
    requireDemo(payment.provider);
    await prisma.onlinePayment.updateMany({ where: { id: payment.id, status: "CREATED" }, data: { status: "CANCELLED" } });
    res.json({ ok: true });
  }),
);
