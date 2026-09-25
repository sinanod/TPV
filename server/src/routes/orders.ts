import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { emitEvent } from "../realtime";
import { h, HttpError } from "../http";
import { orderChanged, tableChanged } from "../cloud/sync";

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

const orderInclude = {
  lines: { include: { product: true }, orderBy: { createdAt: "asc" as const } },
  table: { include: { zone: true } },
  waiter: true,
};

function orderTotal(order: { lines: { qty: number; unitPrice: number }[] }) {
  return order.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
}

async function loadOrder(id: number) {
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) return null;
  return { ...order, total: orderTotal(order) };
}

async function findOpenOrder(id: string) {
  const order = await prisma.order.findUnique({ where: { id: Number(id) } });
  if (!order) throw new HttpError(404, "Comanda no encontrada");
  if (order.status === "PAID" || order.status === "CANCELLED") {
    throw new HttpError(409, "La comanda ya está cerrada");
  }
  return order;
}

async function publishOrder(orderId: number) {
  const updated = await loadOrder(orderId);
  emitEvent("order:updated", { order: updated });
  await orderChanged(orderId);
  return updated;
}

// Comanda activa de una mesa (la crea el cliente vía POST /tables/:id/open antes de llegar aquí)
ordersRouter.get(
  "/orders/table/:tableId",
  h(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { tableId: Number(req.params.tableId), status: { in: ["OPEN", "SENT", "SERVED"] } },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
    });
    if (!order) throw new HttpError(404, "No hay comanda activa en esta mesa");
    res.json({ ...order, total: orderTotal(order) });
  }),
);

ordersRouter.get(
  "/orders/:id",
  h(async (req, res) => {
    const order = await loadOrder(Number(req.params.id));
    if (!order) throw new HttpError(404, "Comanda no encontrada");
    res.json(order);
  }),
);

const addLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.number().int(),
        qty: z.number().int().min(1),
        note: z.string().optional(),
      }),
    )
    .min(1),
});

ordersRouter.post(
  "/orders/:id/lines",
  h(async (req, res) => {
    const parsed = addLinesSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Líneas inválidas");
    const order = await findOpenOrder(req.params.id);

    const products = await prisma.product.findMany({
      where: { id: { in: parsed.data.lines.map((l) => l.productId) }, active: true, available: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    const missing = parsed.data.lines.find((l) => !productMap.has(l.productId));
    if (missing) throw new HttpError(400, `El producto ${missing.productId} no existe o no está disponible`);

    await prisma.$transaction(
      parsed.data.lines.map((l) =>
        prisma.orderLine.create({
          data: {
            orderId: order.id,
            productId: l.productId,
            qty: l.qty,
            unitPrice: productMap.get(l.productId)!.price,
            note: l.note,
            status: "PENDING",
          },
        }),
      ),
    );

    res.status(201).json(await publishOrder(order.id));
  }),
);

ordersRouter.delete(
  "/orders/:id/lines/:lineId",
  h(async (req, res) => {
    const order = await findOpenOrder(req.params.id);
    const line = await prisma.orderLine.findUnique({ where: { id: Number(req.params.lineId) } });
    if (!line || line.orderId !== order.id) throw new HttpError(404, "Línea no encontrada");
    if (line.status === "SENT") throw new HttpError(409, "No se puede borrar una línea ya enviada a cocina");
    await prisma.orderLine.delete({ where: { id: line.id } });

    res.json(await publishOrder(order.id));
  }),
);

// Envía a cocina/barra las líneas pendientes de la comanda
ordersRouter.post(
  "/orders/:id/send",
  h(async (req, res) => {
    const order = await findOpenOrder(req.params.id);
    const pendingLines = await prisma.orderLine.findMany({
      where: { orderId: order.id, status: "PENDING" },
      include: { product: { include: { category: true } } },
    });
    if (pendingLines.length === 0) throw new HttpError(400, "No hay líneas pendientes de enviar");

    await prisma.orderLine.updateMany({
      where: { id: { in: pendingLines.map((l) => l.id) } },
      data: { status: "SENT" },
    });
    await prisma.order.update({ where: { id: order.id }, data: { status: "SENT" } });

    const updated = await publishOrder(order.id);
    emitEvent("order:sent", {
      order: updated,
      lines: pendingLines.map((l) => ({
        id: l.id,
        productName: l.product.name,
        qty: l.qty,
        note: l.note,
        printerTag: l.product.category.printerTag,
      })),
    });
    res.json(updated);
  }),
);

const closeSchema = z.object({ paymentMethod: z.enum(["CASH", "CARD"]) });

ordersRouter.post(
  "/orders/:id/close",
  h(async (req, res) => {
    const parsed = closeSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Método de pago inválido");
    const order = await findOpenOrder(req.params.id);

    await prisma.order.update({
      where: { id: order.id },
      data: { status: "PAID", paymentMethod: parsed.data.paymentMethod, closedAt: new Date() },
    });
    const table = await prisma.table.update({
      where: { id: order.tableId },
      data: { status: "FREE" },
      include: { zone: true },
    });

    emitEvent("table:updated", { table });
    emitEvent("order:closed", { tableId: order.tableId, orderId: order.id });
    await orderChanged(order.id);
    await tableChanged(order.tableId);
    res.json({ table });
  }),
);
