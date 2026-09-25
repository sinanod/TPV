import { prisma } from "../db";

const OPEN_STATUSES = ["OPEN", "SENT", "SERVED"];

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

export async function enqueueOrder(orderId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      table: { include: { zone: true } },
      waiter: true,
      lines: { include: { product: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) return false;

  await enqueue(`order:${order.uuid}`, "order.upsert", {
    localUuid: order.uuid,
    tableId: order.table.cloudId,
    tableLabel: `${order.table.zone.name} · Mesa ${order.table.number}`,
    waiterName: order.waiter.name,
    status: order.status,
    paymentMethod: order.paymentMethod,
    total: Math.round(order.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) * 100) / 100,
    openedAt: order.createdAt.toISOString(),
    closedAt: order.closedAt?.toISOString() ?? null,
    lines: order.lines.map((l) => ({
      productId: l.product.cloudId,
      productName: l.product.name,
      qty: l.qty,
      unitPrice: l.unitPrice,
      note: l.note,
      status: l.status,
    })),
  });
  return true;
}

/** Estado actual completo: se reenvía en cada reconexión para que la nube converja. */
export async function enqueueSnapshot() {
  const tables = await prisma.table.findMany({ where: { active: true, cloudId: { not: null } } });
  for (const t of tables) await enqueueTable(t.id);
  const openOrders = await prisma.order.findMany({ where: { status: { in: OPEN_STATUSES } } });
  for (const o of openOrders) await enqueueOrder(o.id);
}
