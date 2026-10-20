import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requirePortal } from "../auth";
import { h, HttpError } from "../lib/http";
import { disconnectDevice, emitToPortal, isDeviceOnline } from "../realtime";

// Lectura del estado del restaurante. El portal no hace operaciones de TPV:
// no hay rutas para abrir mesas, añadir productos ni cobrar.
export const portalRouter = Router();
portalRouter.use(requirePortal);

const OPEN_STATUSES = ["OPEN", "SENT", "SERVED"];

const round2 = (n: number) => Math.round(n * 100) / 100;

portalRouter.get(
  "/overview",
  h(async (req, res) => {
    const tenantId = req.tenantId!;
    const since = req.query.since ? z.coerce.date().parse(req.query.since) : startOfUtcDay();

    const [tenant, devices, tableGroups, openOrders, paidToday] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      prisma.device.findMany({ where: { tenantId, revokedAt: null }, orderBy: { createdAt: "asc" } }),
      prisma.diningTable.groupBy({ by: ["status"], where: { tenantId }, _count: true }),
      prisma.order.aggregate({
        where: { tenantId, status: { in: OPEN_STATUSES } },
        _count: true,
        _sum: { total: true },
      }),
      prisma.order.aggregate({
        where: { tenantId, status: "PAID", closedAt: { gte: since } },
        _count: true,
        _sum: { total: true },
      }),
    ]);

    const countFor = (status: string) => tableGroups.find((g) => g.status === status)?._count ?? 0;
    const revenue = paidToday._sum.total ?? 0;

    res.json({
      tenant: { id: tenant.id, name: tenant.name },
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        invoiceSeries: `T${d.seriesNumber}`,
        online: isDeviceOnline(d.id),
        lastSeenAt: d.lastSeenAt,
        createdAt: d.createdAt,
      })),
      tables: { free: countFor("FREE"), occupied: countFor("OCCUPIED"), billRequested: countFor("BILL_REQUESTED") },
      openOrders: { count: openOrders._count, total: round2(openOrders._sum.total ?? 0) },
      today: {
        revenue: round2(revenue),
        count: paidToday._count,
        averageTicket: paidToday._count ? round2(revenue / paidToday._count) : 0,
      },
    });
  }),
);

// Salón: zonas y mesas (configuración + estado en vivo + comanda abierta)
portalRouter.get(
  "/floor",
  h(async (req, res) => {
    const tenantId = req.tenantId!;
    const zones = await prisma.zone.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        tables: {
          orderBy: { number: "asc" },
          include: {
            orders: {
              where: { status: { in: OPEN_STATUSES } },
              orderBy: { openedAt: "desc" },
              take: 1,
              select: { id: true, total: true, waiterName: true, openedAt: true, status: true },
            },
          },
        },
      },
    });

    res.json(
      zones.map((z) => ({
        id: z.id,
        name: z.name,
        sortOrder: z.sortOrder,
        tables: z.tables.map(({ orders, ...t }) => ({ ...t, openOrder: orders[0] ?? null })),
      })),
    );
  }),
);

portalRouter.get(
  "/orders/open",
  h(async (req, res) => {
    const orders = await prisma.order.findMany({
      where: { tenantId: req.tenantId!, status: { in: OPEN_STATUSES } },
      orderBy: { openedAt: "asc" },
      include: { lines: true },
    });
    res.json(orders);
  }),
);

const salesQuery = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

const MAX_TICKETS = 5000;

// Tickets cobrados en un rango. El cliente envía los límites ya calculados
// en su zona horaria y agrupa por día en su lado.
portalRouter.get(
  "/sales",
  h(async (req, res) => {
    const { from, to } = salesQuery.parse(req.query);
    if (from > to) throw new HttpError(400, "La fecha inicial es posterior a la final");

    const tickets = await prisma.order.findMany({
      where: { tenantId: req.tenantId!, status: "PAID", closedAt: { gte: from, lt: to } },
      orderBy: { closedAt: "desc" },
      take: MAX_TICKETS,
      include: { lines: true, payments: { orderBy: { createdAt: "asc" } } },
    });

    const revenue = tickets.reduce((s, t) => s + t.total, 0);
    // Una cuenta dividida suma en cada forma de pago lo que se pagó con ella.
    // Las comandas de antes de los pagos divididos no tienen pagos: cuentan enteras.
    const byPayment: Record<string, number> = {};
    const add = (key: string, euros: number) => (byPayment[key] = round2((byPayment[key] ?? 0) + euros));
    for (const t of tickets) {
      const paid = t.payments.filter((p) => p.amountCents > 0);
      if (paid.length) paid.forEach((p) => add(p.method, p.amountCents / 100));
      else add(t.paymentMethod ?? "OTHER", t.total);
    }

    res.json({
      totals: {
        revenue: round2(revenue),
        count: tickets.length,
        averageTicket: tickets.length ? round2(revenue / tickets.length) : 0,
        byPayment,
      },
      truncated: tickets.length === MAX_TICKETS,
      tickets,
    });
  }),
);

// ---------- Facturas y VERI*FACTU ----------

const invoicesQuery = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  aeatStatus: z.enum(["PENDING", "CORRECT", "ACCEPTED_WITH_ERRORS", "REJECTED", "NOT_APPLICABLE"]).optional(),
});

portalRouter.get(
  "/invoices",
  h(async (req, res) => {
    const { from, to, aeatStatus } = invoicesQuery.parse(req.query);
    const invoices = await prisma.invoice.findMany({
      where: { tenantId: req.tenantId!, issuedAt: { gte: from, lt: to }, ...(aeatStatus ? { aeatStatus } : {}) },
      orderBy: { issuedAt: "desc" },
      take: MAX_TICKETS,
      include: { emails: { select: { to: true, status: true, lastError: true } }, submission: { select: { csv: true } } },
    });
    res.json(
      invoices.map((i) => ({
        id: i.id,
        numSerie: i.numSerie,
        issuedAt: i.issuedAt,
        totalCents: i.totalCents,
        taxCents: i.taxCents,
        tableLabel: i.tableLabel,
        waiterName: i.waiterName,
        lines: i.lines,
        payments: i.payments,
        qrUrl: i.qrUrl,
        environment: i.environment,
        aeatStatus: i.aeatStatus,
        aeatErrorCode: i.aeatErrorCode,
        aeatError: i.aeatError,
        aeatSentAt: i.aeatSentAt,
        aeatCsv: i.submission?.csv ?? null,
        emails: i.emails,
      })),
    );
  }),
);

// Enviar (o reenviar) el ticket por email a un cliente
portalRouter.post(
  "/invoices/:id/email",
  h(async (req, res) => {
    const { email } = z.object({ email: z.string().trim().email() }).parse(req.body);
    const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, tenantId: req.tenantId! } });
    if (!invoice) throw new HttpError(404, "Factura no encontrada");
    const to = email.toLowerCase();
    await prisma.emailMessage.upsert({
      where: { invoiceId_to: { invoiceId: invoice.id, to } },
      create: { tenantId: req.tenantId!, invoiceId: invoice.id, to },
      update: { status: "PENDING", attempts: 0, lastError: null, createdAt: new Date() },
    });
    res.status(202).json({ queued: true });
  }),
);

portalRouter.get(
  "/verifactu/submissions",
  h(async (req, res) => {
    const submissions = await prisma.aeatSubmission.findMany({
      where: { tenantId: req.tenantId! },
      orderBy: { sentAt: "desc" },
      take: 30,
      select: { id: true, environment: true, sentAt: true, status: true, csv: true, waitSeconds: true, records: true, error: true },
    });
    res.json(submissions);
  }),
);

portalRouter.get(
  "/online-payments",
  h(async (req, res) => {
    const payments = await prisma.onlinePayment.findMany({
      where: { tenantId: req.tenantId!, status: "SUCCEEDED" },
      orderBy: { paidAt: "desc" },
      take: 100,
      include: { table: { include: { zone: true } } },
    });
    res.json(
      payments.map((p) => ({
        id: p.id,
        tableLabel: `${p.table.zone.name} · Mesa ${p.table.number}`,
        amountCents: p.amountCents,
        email: p.email,
        paidAt: p.paidAt,
        applyResult: p.applyResult,
        refundCents: p.refundCents,
      })),
    );
  }),
);

portalRouter.delete(
  "/devices/:id",
  h(async (req, res) => {
    const result = await prisma.device.updateMany({
      where: { id: req.params.id, tenantId: req.tenantId!, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw new HttpError(404, "Dispositivo no encontrado");
    disconnectDevice(req.params.id);
    emitToPortal(req.tenantId!, "devices:updated");
    res.status(204).end();
  }),
);

function startOfUtcDay() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
