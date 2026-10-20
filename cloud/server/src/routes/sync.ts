import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { authenticateTenant, generateDeviceToken, hashDeviceToken, requireDevice } from "../auth";
import { h, HttpError } from "../lib/http";
import { buildConfigSnapshot } from "../lib/configSync";
import { queueReceiptEmail } from "../email/sender";
import { emitToPortal } from "../realtime";
import { loginLimiter } from "./auth";

// API que usan los servidores locales de los restaurantes.
export const syncRouter = Router();

const registerSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  deviceName: z.string().trim().min(1).max(100).default("Servidor local"),
});

syncRouter.post(
  "/register",
  loginLimiter,
  h(async (req, res) => {
    const { username, password, deviceName } = registerSchema.parse(req.body);
    const tenant = await authenticateTenant(username, password);
    if (!tenant) throw new HttpError(401, "Usuario o contraseña incorrectos");

    // El token solo se devuelve esta vez; en la base de datos se guarda su hash.
    const deviceToken = generateDeviceToken();
    // Cada TPV factura con su propia serie (T1, T2...): dos instalaciones no
    // pueden compartir numeración ni cadena VERI*FACTU.
    const last = await prisma.device.findFirst({ where: { tenantId: tenant.id }, orderBy: { seriesNumber: "desc" } });
    const device = await prisma.device.create({
      data: {
        tenantId: tenant.id,
        name: deviceName,
        tokenHash: hashDeviceToken(deviceToken),
        seriesNumber: (last?.seriesNumber ?? 0) + 1,
        lastSeenAt: new Date(),
      },
    });
    emitToPortal(tenant.id, "devices:updated");

    res.status(201).json({
      deviceId: device.id,
      deviceToken,
      tenant: { id: tenant.id, name: tenant.name, username: tenant.username },
    });
  }),
);

syncRouter.get(
  "/config",
  requireDevice,
  h(async (req, res) => {
    res.json(await buildConfigSnapshot(req.tenantId!, req.deviceId!));
  }),
);

// Logo del ticket (el snapshot solo lleva su hash, para no reenviarlo con cada cambio)
syncRouter.get(
  "/ticket-logo",
  requireDevice,
  h(async (req, res) => {
    const s = await prisma.tenantSettings.findUnique({
      where: { tenantId: req.tenantId! },
      select: { ticketLogo: true, ticketLogoHash: true },
    });
    if (!s?.ticketLogo || !s.ticketLogoHash) throw new HttpError(404, "Este restaurante no tiene logo");
    res.set({ "Content-Type": "image/png", ETag: `"${s.ticketLogoHash}"`, "Cache-Control": "no-cache" });
    res.send(Buffer.from(s.ticketLogo));
  }),
);

const tableStatus = z.enum(["FREE", "OCCUPIED", "BILL_REQUESTED"]);
const orderStatus = z.enum(["OPEN", "SENT", "SERVED", "PAID", "CANCELLED"]);

const paymentSchema = z.object({
  uuid: z.string().min(1),
  method: z.enum(["CASH", "CARD", "ONLINE"]),
  amountCents: z.number().int().min(0),
  tenderedCents: z.number().int().nullable(),
  refundCents: z.number().int().min(0).default(0),
  onlinePaymentId: z.string().nullable(),
  createdAt: z.coerce.date(),
});

const tableStatusEvent = z.object({
  id: z.string().min(1),
  type: z.literal("table.status"),
  at: z.coerce.date(),
  data: z.object({ tableId: z.string(), status: tableStatus }),
});

const orderUpsertEvent = z.object({
  id: z.string().min(1),
  type: z.literal("order.upsert"),
  at: z.coerce.date(),
  data: z.object({
    localUuid: z.string().min(1),
    tableId: z.string().nullable(),
    tableLabel: z.string(),
    waiterName: z.string().nullable(),
    status: orderStatus,
    paymentMethod: z.string().nullable(),
    total: z.number(),
    openedAt: z.coerce.date(),
    closedAt: z.coerce.date().nullable(),
    invoiceNumber: z.string().nullable().optional(),
    payments: z.array(paymentSchema).default([]),
    lines: z.array(
      z.object({
        productId: z.string().nullable(),
        productName: z.string(),
        qty: z.number().int(),
        unitPrice: z.number(),
        note: z.string().nullable(),
        status: z.string(),
      }),
    ),
  }),
});

const invoiceIssuedEvent = z.object({
  id: z.string().min(1),
  type: z.literal("invoice.issued"),
  at: z.coerce.date(),
  data: z.object({
    uuid: z.string().min(1),
    orderUuid: z.string().min(1),
    numSerie: z.string().min(1).max(60),
    issuedAt: z.coerce.date(),
    issueDate: z.string().regex(/^\d{2}-\d{2}-\d{4}$/),
    totalCents: z.number().int(),
    taxCents: z.number().int(),
    breakdown: z.array(z.object({ rate: z.number(), baseCents: z.number().int(), quotaCents: z.number().int() })),
    tableLabel: z.string(),
    waiterName: z.string().nullable(),
    lines: z.array(
      z.object({ name: z.string(), qty: z.number().int(), unitPrice: z.number(), taxRate: z.number(), totalCents: z.number().int() }),
    ),
    payments: z.array(paymentSchema),
    emails: z.array(z.string().email()).max(20),
    verifactu: z
      .object({
        chainSeq: z.number().int().positive(),
        issuerNif: z.string().length(9),
        hash: z.string().length(64),
        recordXml: z.string().startsWith("<sf:RegistroAlta").max(20_000),
        qrUrl: z.string().url(),
        environment: z.enum(["TEST", "PRODUCTION"]),
      })
      .nullable(),
  }),
});

const invoiceEmailEvent = z.object({
  id: z.string().min(1),
  type: z.literal("invoice.email"),
  at: z.coerce.date(),
  data: z.object({ invoiceUuid: z.string().min(1), email: z.string().email() }),
});

const paymentAppliedEvent = z.object({
  id: z.string().min(1),
  type: z.literal("payment.applied"),
  at: z.coerce.date(),
  data: z.object({
    onlinePaymentId: z.string().min(1),
    result: z.enum(["APPLIED", "REFUND_REQUIRED", "ORDER_NOT_FOUND"]),
    refundCents: z.number().int().min(0),
    localPaymentUuid: z.string().nullable(),
  }),
});

const devicePrintersEvent = z.object({
  id: z.string().min(1),
  type: z.literal("device.printers"),
  at: z.coerce.date(),
  data: z.object({ systemPrinters: z.array(z.string().max(200)).max(100) }),
});

const syncEvent = z.discriminatedUnion("type", [
  tableStatusEvent,
  orderUpsertEvent,
  invoiceIssuedEvent,
  invoiceEmailEvent,
  paymentAppliedEvent,
  devicePrintersEvent,
]);
type SyncEvent = z.infer<typeof syncEvent>;

const eventsSchema = z.object({ events: z.array(z.unknown()).max(500) });

async function applyEvent(tenantId: string, deviceId: string, event: SyncEvent) {
  if (event.type === "invoice.issued") return applyInvoice(tenantId, deviceId, event.data);
  if (event.type === "invoice.email") {
    const invoice = await prisma.invoice.findUnique({
      where: { tenantId_localUuid: { tenantId, localUuid: event.data.invoiceUuid } },
    });
    if (!invoice) throw new EventRejected("Factura desconocida");
    await queueReceiptEmail(tenantId, invoice.id, event.data.email);
    return;
  }
  if (event.type === "payment.applied") {
    const d = event.data;
    await prisma.onlinePayment.updateMany({
      where: { id: d.onlinePaymentId, tenantId },
      data: { appliedAt: new Date(), applyResult: d.result, refundCents: d.refundCents, localPaymentUuid: d.localPaymentUuid },
    });
    return;
  }
  if (event.type === "device.printers") {
    await prisma.device.update({ where: { id: deviceId }, data: { systemPrinters: event.data.systemPrinters } });
    return;
  }
  if (event.type === "table.status") {
    // Solo si el evento es más reciente que el estado guardado (los
    // reintentos pueden llegar desordenados).
    await prisma.diningTable.updateMany({
      where: {
        id: event.data.tableId,
        tenantId,
        OR: [{ statusAt: null }, { statusAt: { lte: event.at } }],
      },
      data: { status: event.data.status, statusAt: event.at },
    });
    return;
  }

  const d = event.data;
  const tableExists = d.tableId
    ? (await prisma.diningTable.count({ where: { id: d.tableId, tenantId } })) > 0
    : false;

  const fields = {
    tableId: tableExists ? d.tableId : null,
    tableLabel: d.tableLabel,
    waiterName: d.waiterName,
    status: d.status,
    paymentMethod: d.paymentMethod,
    total: d.total,
    openedAt: d.openedAt,
    closedAt: d.closedAt,
    invoiceNumber: d.invoiceNumber ?? null,
    sourceAt: event.at,
  };
  const payments = d.payments.map((p) => ({
    localUuid: p.uuid,
    method: p.method,
    amountCents: p.amountCents,
    tenderedCents: p.tenderedCents,
    refundCents: p.refundCents,
    onlinePaymentId: p.onlinePaymentId,
    createdAt: p.createdAt,
  }));
  const lines = d.lines.map((l) => ({
    productId: l.productId,
    productName: l.productName,
    qty: l.qty,
    unitPrice: l.unitPrice,
    note: l.note,
    status: l.status,
  }));

  await prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({
      where: { tenantId_localUuid: { tenantId, localUuid: d.localUuid } },
    });
    if (!existing) {
      await tx.order.create({
        data: { tenantId, localUuid: d.localUuid, ...fields, lines: { create: lines }, payments: { create: payments } },
      });
      return;
    }
    if (existing.sourceAt > event.at) return;
    await tx.orderLine.deleteMany({ where: { orderId: existing.id } });
    await tx.orderPayment.deleteMany({ where: { orderId: existing.id } });
    await tx.order.update({
      where: { id: existing.id },
      data: { ...fields, lines: { create: lines }, payments: { create: payments } },
    });
  });
}

class EventRejected extends Error {}

type InvoiceData = z.infer<typeof invoiceIssuedEvent>["data"];

// Las facturas son inmutables: si ya existe (reintento), no se toca.
async function applyInvoice(tenantId: string, deviceId: string, d: InvoiceData) {
  const existing = await prisma.invoice.findUnique({ where: { tenantId_localUuid: { tenantId, localUuid: d.uuid } } });
  const invoice =
    existing ??
    (await prisma.invoice.create({
      data: {
        tenantId,
        deviceId,
        localUuid: d.uuid,
        orderLocalUuid: d.orderUuid,
        numSerie: d.numSerie,
        issuedAt: d.issuedAt,
        issueDate: d.issueDate,
        totalCents: d.totalCents,
        taxCents: d.taxCents,
        breakdown: d.breakdown,
        tableLabel: d.tableLabel,
        waiterName: d.waiterName,
        lines: d.lines,
        payments: d.payments,
        ...(d.verifactu
          ? {
              chainSeq: d.verifactu.chainSeq,
              issuerNif: d.verifactu.issuerNif,
              hash: d.verifactu.hash,
              recordXml: d.verifactu.recordXml,
              qrUrl: d.verifactu.qrUrl,
              environment: d.verifactu.environment,
              aeatStatus: "PENDING",
            }
          : {}),
      },
    }));
  for (const email of d.emails) await queueReceiptEmail(tenantId, invoice.id, email);
}

syncRouter.get(
  "/online-payments",
  requireDevice,
  h(async (req, res) => {
    const pending = await prisma.onlinePayment.findMany({
      where: { tenantId: req.tenantId!, status: "SUCCEEDED", appliedAt: null },
      orderBy: { paidAt: "asc" },
    });
    res.json(
      pending.map((p) => ({ id: p.id, orderLocalUuid: p.orderLocalUuid, amountCents: p.amountCents, email: p.email })),
    );
  }),
);

syncRouter.post(
  "/events",
  requireDevice,
  h(async (req, res) => {
    const { events } = eventsSchema.parse(req.body);
    const accepted: string[] = [];
    // Un evento mal formado no debe bloquear para siempre la cola del
    // servidor local: se rechaza con motivo y el resto se procesa.
    const rejected: { id: string | null; error: string }[] = [];

    for (const raw of events) {
      const parsed = syncEvent.safeParse(raw);
      if (!parsed.success) {
        const id = typeof raw === "object" && raw && "id" in raw ? String((raw as { id: unknown }).id) : null;
        rejected.push({ id, error: parsed.error.issues[0]?.message ?? "Evento no válido" });
        continue;
      }
      try {
        await applyEvent(req.tenantId!, req.deviceId!, parsed.data);
      } catch (e) {
        if (!(e instanceof EventRejected)) throw e;
        rejected.push({ id: parsed.data.id, error: e.message });
        continue;
      }
      accepted.push(parsed.data.id);
    }

    if (accepted.length) {
      emitToPortal(req.tenantId!, "live:updated");
      emitToPortal(req.tenantId!, "verifactu:updated");
    }
    res.json({ accepted, rejected });
  }),
);
