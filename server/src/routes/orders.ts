import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { emitEvent } from "../realtime";

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

// Comanda activa de una mesa (la crea el cliente vía POST /tables/:id/open antes de llegar aquí)
ordersRouter.get("/orders/table/:tableId", async (req, res) => {
  const tableId = Number(req.params.tableId);
  const order = await prisma.order.findFirst({
    where: { tableId, status: { in: ["OPEN", "SENT", "SERVED"] } },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
  if (!order) return res.status(404).json({ error: "No hay comanda activa en esta mesa" });
  res.json({ ...order, total: orderTotal(order) });
});

ordersRouter.get("/orders/:id", async (req, res) => {
  const order = await loadOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ error: "Comanda no encontrada" });
  res.json(order);
});

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

ordersRouter.post("/orders/:id/lines", async (req, res) => {
  const orderId = Number(req.params.id);
  const parsed = addLinesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Líneas inválidas" });

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return res.status(404).json({ error: "Comanda no encontrada" });
  if (order.status === "PAID" || order.status === "CANCELLED") {
    return res.status(409).json({ error: "La comanda ya está cerrada" });
  }

  const products = await prisma.product.findMany({
    where: { id: { in: parsed.data.lines.map((l) => l.productId) } },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  await prisma.$transaction(
    parsed.data.lines.map((l) => {
      const product = productMap.get(l.productId);
      if (!product) throw new Error(`Producto ${l.productId} no existe`);
      return prisma.orderLine.create({
        data: {
          orderId,
          productId: l.productId,
          qty: l.qty,
          unitPrice: product.price,
          note: l.note,
          status: "PENDING",
        },
      });
    }),
  );

  const updated = await loadOrder(orderId);
  emitEvent("order:updated", { order: updated });
  res.status(201).json(updated);
});

ordersRouter.delete("/orders/:id/lines/:lineId", async (req, res) => {
  const orderId = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  const line = await prisma.orderLine.findUnique({ where: { id: lineId } });
  if (!line || line.orderId !== orderId) {
    return res.status(404).json({ error: "Línea no encontrada" });
  }
  if (line.status === "SENT") {
    return res.status(409).json({ error: "No se puede borrar una línea ya enviada a cocina" });
  }
  await prisma.orderLine.delete({ where: { id: lineId } });

  const updated = await loadOrder(orderId);
  emitEvent("order:updated", { order: updated });
  res.json(updated);
});

// Envía a cocina/barra las líneas pendientes de la comanda
ordersRouter.post("/orders/:id/send", async (req, res) => {
  const orderId = Number(req.params.id);
  const pendingLines = await prisma.orderLine.findMany({
    where: { orderId, status: "PENDING" },
    include: { product: { include: { category: true } } },
  });

  if (pendingLines.length === 0) {
    return res.status(400).json({ error: "No hay líneas pendientes de enviar" });
  }

  await prisma.orderLine.updateMany({
    where: { id: { in: pendingLines.map((l) => l.id) } },
    data: { status: "SENT" },
  });
  await prisma.order.update({ where: { id: orderId }, data: { status: "SENT" } });

  const updated = await loadOrder(orderId);
  emitEvent("order:updated", { order: updated });
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
});

const closeSchema = z.object({ paymentMethod: z.enum(["CASH", "CARD"]) });

ordersRouter.post("/orders/:id/close", async (req, res) => {
  const orderId = Number(req.params.id);
  const parsed = closeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Método de pago inválido" });

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return res.status(404).json({ error: "Comanda no encontrada" });

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "PAID", paymentMethod: parsed.data.paymentMethod, closedAt: new Date() },
  });
  const table = await prisma.table.update({
    where: { id: order.tableId },
    data: { status: "FREE" },
    include: { zone: true },
  });

  emitEvent("table:updated", { table });
  emitEvent("order:closed", { tableId: order.tableId, orderId });
  res.json({ table });
});
