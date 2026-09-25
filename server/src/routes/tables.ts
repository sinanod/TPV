import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { emitEvent } from "../realtime";

export const tablesRouter = Router();

tablesRouter.use(requireAuth);

tablesRouter.get("/zones", async (_req, res) => {
  const zones = await prisma.zone.findMany({
    include: { tables: { orderBy: { number: "asc" } } },
    orderBy: { name: "asc" },
  });
  res.json(zones);
});

tablesRouter.get("/tables", async (_req, res) => {
  const tables = await prisma.table.findMany({
    include: { zone: true },
    orderBy: [{ zoneId: "asc" }, { number: "asc" }],
  });
  res.json(tables);
});

// Abre una mesa: la marca OCCUPIED y crea la comanda OPEN si no existe una activa
tablesRouter.post("/tables/:id/open", async (req, res) => {
  const tableId = Number(req.params.id);
  const table = await prisma.table.findUnique({ where: { id: tableId } });
  if (!table) return res.status(404).json({ error: "Mesa no encontrada" });

  let order = await prisma.order.findFirst({
    where: { tableId, status: { in: ["OPEN", "SENT", "SERVED"] } },
  });

  if (!order) {
    order = await prisma.order.create({
      data: { tableId, waiterId: req.auth!.userId, status: "OPEN" },
    });
  }

  const updatedTable = await prisma.table.update({
    where: { id: tableId },
    data: { status: "OCCUPIED" },
    include: { zone: true },
  });

  emitEvent("table:updated", { table: updatedTable });
  res.json({ table: updatedTable, order });
});

// El camarero pide la cuenta en la mesa (sin cobrar todavía)
tablesRouter.post("/tables/:id/request-bill", async (req, res) => {
  const tableId = Number(req.params.id);
  const table = await prisma.table.update({
    where: { id: tableId },
    data: { status: "BILL_REQUESTED" },
    include: { zone: true },
  });
  emitEvent("table:updated", { table });
  res.json({ table });
});
