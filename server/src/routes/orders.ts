import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { emitEvent } from "../realtime";
import { h, HttpError } from "../http";
import { orderChanged } from "../cloud/sync";
import { cancelEmptyOrder, OPEN_STATUSES, orderTotals, registerPayment, toCents } from "../billing";
import { publishPayment } from "../payments";
import { printBill, printKitchenTickets } from "../printing/service";

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

const orderInclude = {
  lines: { include: { product: true }, orderBy: { createdAt: "asc" as const } },
  payments: { orderBy: { createdAt: "asc" as const } },
  invoice: { select: { id: true, uuid: true, numSerie: true, qrUrl: true } },
  table: { include: { zone: true } },
  waiter: true,
};

async function loadOrder(id: number) {
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) return null;
  const { totalCents, paidCents, pendingCents } = orderTotals(order);
  return { ...order, total: totalCents / 100, paid: paidCents / 100, pending: pendingCents / 100 };
}

async function findOpenOrder(id: string) {
  const order = await prisma.order.findUnique({ where: { id: Number(id) } });
  if (!order) throw new HttpError(404, "Comanda no encontrada");
  if (!OPEN_STATUSES.includes(order.status)) throw new HttpError(409, "La comanda ya está cerrada");
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
      where: { tableId: Number(req.params.tableId), status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!order) throw new HttpError(404, "No hay comanda activa en esta mesa");
    res.json(await loadOrder(order.id));
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
      parsed.data.lines.map((l) => {
        const product = productMap.get(l.productId)!;
        return prisma.orderLine.create({
          data: {
            orderId: order.id,
            productId: l.productId,
            qty: l.qty,
            unitPrice: product.price,
            taxRate: product.taxRate,
            note: l.note,
            status: "PENDING",
          },
        });
      }),
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

    const current = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true, payments: true } });
    const { pendingCents } = orderTotals(current);
    if (pendingCents - toCents(line.qty * line.unitPrice) < 0) {
      throw new HttpError(409, "Ya se ha cobrado parte de la cuenta: no se puede quitar este producto");
    }
    await prisma.orderLine.delete({ where: { id: line.id } });

    res.json(await publishOrder(order.id));
  }),
);

// Envía a cocina/barra las líneas pendientes: cada una sale en la impresora
// de su familia.
ordersRouter.post(
  "/orders/:id/send",
  h(async (req, res) => {
    const order = await findOpenOrder(req.params.id);
    const pendingLines = await prisma.orderLine.findMany({
      where: { orderId: order.id, status: "PENDING" },
      include: { product: { include: { category: { include: { printer: true } } } } },
    });
    if (pendingLines.length === 0) throw new HttpError(400, "No hay líneas pendientes de enviar");

    await prisma.orderLine.updateMany({
      where: { id: { in: pendingLines.map((l) => l.id) } },
      data: { status: "SENT" },
    });
    await prisma.order.update({ where: { id: order.id }, data: { status: "SENT" } });

    const prints = await printKitchenTickets(
      order.id,
      pendingLines.map((l) => l.id),
    );
    const updated = await publishOrder(order.id);
    emitEvent("order:sent", {
      order: updated,
      lines: pendingLines.map((l) => ({
        id: l.id,
        productName: l.product.name,
        qty: l.qty,
        note: l.note,
        printer: l.product.category.printer?.name ?? null,
      })),
    });
    res.json({ ...updated, prints });
  }),
);

const paymentSchema = z.object({
  method: z.enum(["CASH", "CARD"]),
  /** Por defecto, todo lo pendiente */
  amount: z.number().positive().optional(),
  /** Solo efectivo: lo que entrega el cliente, para calcular el cambio */
  tendered: z.number().positive().optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
});

// Cobro (total o parcial) en la mesa. Al completar la cuenta se emite la
// factura simplificada, se libera la mesa y se imprime el ticket.
ordersRouter.post(
  "/orders/:id/payments",
  h(async (req, res) => {
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Datos del cobro no válidos (revisa el importe y el email)");
    const order = await findOpenOrder(req.params.id);

    const result = await registerPayment(order.id, {
      method: parsed.data.method,
      amountCents: parsed.data.amount === undefined ? undefined : toCents(parsed.data.amount),
      tenderedCents: parsed.data.tendered === undefined ? undefined : toCents(parsed.data.tendered),
      email: parsed.data.email || null,
      waiterId: req.auth!.userId,
    });
    const receiptPrint = await publishPayment(result);
    res.status(201).json({
      order: await loadOrder(order.id),
      change: result.changeCents / 100,
      invoice: result.invoiceId
        ? await prisma.invoice.findUnique({ where: { id: result.invoiceId }, select: { id: true, uuid: true, numSerie: true } })
        : null,
      receiptPrint,
    });
  }),
);

const closeSchema = z.object({
  paymentMethod: z.enum(["CASH", "CARD"]),
  email: z.string().trim().email().optional().or(z.literal("")),
});

// Cobra todo lo pendiente de una vez (atajo del cobro). Una mesa abierta sin
// consumir se libera sin factura.
ordersRouter.post(
  "/orders/:id/close",
  h(async (req, res) => {
    const parsed = closeSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Método de pago inválido");
    const order = await findOpenOrder(req.params.id);
    const current = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true, payments: true } });

    if (current.lines.length === 0 && current.payments.length === 0) {
      await cancelEmptyOrder(order.id);
      const table = await prisma.table.findUniqueOrThrow({ where: { id: order.tableId }, include: { zone: true } });
      emitEvent("table:updated", { table });
      emitEvent("order:closed", { tableId: order.tableId, orderId: order.id });
      await orderChanged(order.id);
      return res.json({ table, invoice: null });
    }

    const result = await registerPayment(order.id, {
      method: parsed.data.paymentMethod,
      email: parsed.data.email || null,
      waiterId: req.auth!.userId,
    });
    const receiptPrint = await publishPayment(result);
    const table = await prisma.table.findUniqueOrThrow({ where: { id: order.tableId }, include: { zone: true } });
    res.json({
      table,
      invoice: result.invoiceId
        ? await prisma.invoice.findUnique({ where: { id: result.invoiceId }, select: { id: true, uuid: true, numSerie: true } })
        : null,
      receiptPrint,
    });
  }),
);

// Cuenta previa para que el cliente revise antes de pagar (no es factura)
ordersRouter.post(
  "/orders/:id/print-bill",
  h(async (req, res) => {
    const order = await findOpenOrder(req.params.id);
    const result = await printBill(order.id);
    if (!result) throw new HttpError(409, "No hay impresora de tickets configurada");
    res.json(result);
  }),
);
