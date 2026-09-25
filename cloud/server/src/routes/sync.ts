import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { authenticateTenant, generateDeviceToken, hashDeviceToken, requireDevice } from "../auth";
import { h, HttpError } from "../lib/http";
import { buildConfigSnapshot } from "../lib/configSync";
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
    const device = await prisma.device.create({
      data: { tenantId: tenant.id, name: deviceName, tokenHash: hashDeviceToken(deviceToken), lastSeenAt: new Date() },
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
    res.json(await buildConfigSnapshot(req.tenantId!));
  }),
);

const tableStatus = z.enum(["FREE", "OCCUPIED", "BILL_REQUESTED"]);
const orderStatus = z.enum(["OPEN", "SENT", "SERVED", "PAID", "CANCELLED"]);

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

const syncEvent = z.discriminatedUnion("type", [tableStatusEvent, orderUpsertEvent]);
type SyncEvent = z.infer<typeof syncEvent>;

const eventsSchema = z.object({ events: z.array(z.unknown()).max(500) });

async function applyEvent(tenantId: string, event: SyncEvent) {
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
    sourceAt: event.at,
  };
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
        data: { tenantId, localUuid: d.localUuid, ...fields, lines: { create: lines } },
      });
      return;
    }
    if (existing.sourceAt > event.at) return;
    await tx.orderLine.deleteMany({ where: { orderId: existing.id } });
    await tx.order.update({
      where: { id: existing.id },
      data: { ...fields, lines: { create: lines } },
    });
  });
}

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
      await applyEvent(req.tenantId!, parsed.data);
      accepted.push(parsed.data.id);
    }

    if (accepted.length) emitToPortal(req.tenantId!, "live:updated");
    res.json({ accepted, rejected });
  }),
);
