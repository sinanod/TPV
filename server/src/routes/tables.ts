import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { emitEvent } from "../realtime";
import { h, HttpError } from "../http";
import { orderChanged, tableChanged } from "../cloud/sync";

export const tablesRouter = Router();

tablesRouter.use(requireAuth);

tablesRouter.get(
  "/zones",
  h(async (_req, res) => {
    const zones = await prisma.zone.findMany({
      where: { active: true },
      include: { tables: { where: { active: true }, orderBy: { number: "asc" } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    res.json(zones);
  }),
);

tablesRouter.get(
  "/tables",
  h(async (_req, res) => {
    const tables = await prisma.table.findMany({
      where: { active: true, zone: { active: true } },
      include: { zone: true },
      orderBy: [{ zoneId: "asc" }, { number: "asc" }],
    });
    res.json(tables);
  }),
);

async function findActiveTable(id: string) {
  const table = await prisma.table.findFirst({ where: { id: Number(id), active: true } });
  if (!table) throw new HttpError(404, "Mesa no encontrada");
  return table;
}

// Abre una mesa: la marca OCCUPIED y crea la comanda OPEN si no existe una activa
tablesRouter.post(
  "/tables/:id/open",
  h(async (req, res) => {
    const table = await findActiveTable(req.params.id);

    let order = await prisma.order.findFirst({
      where: { tableId: table.id, status: { in: ["OPEN", "SENT", "SERVED"] } },
    });
    const created = !order;
    if (!order) {
      order = await prisma.order.create({
        data: { tableId: table.id, waiterId: req.auth!.userId, status: "OPEN" },
      });
    }

    const updatedTable = await prisma.table.update({
      where: { id: table.id },
      data: { status: "OCCUPIED" },
      include: { zone: true },
    });

    emitEvent("table:updated", { table: updatedTable });
    await tableChanged(table.id);
    if (created) await orderChanged(order.id);
    res.json({ table: updatedTable, order });
  }),
);

// El camarero pide la cuenta en la mesa (sin cobrar todavía)
tablesRouter.post(
  "/tables/:id/request-bill",
  h(async (req, res) => {
    const found = await findActiveTable(req.params.id);
    const table = await prisma.table.update({
      where: { id: found.id },
      data: { status: "BILL_REQUESTED" },
      include: { zone: true },
    });
    emitEvent("table:updated", { table });
    await tableChanged(table.id);
    res.json({ table });
  }),
);
