import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { h } from "../http";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get(
  "/dashboard/summary",
  h(async (_req, res) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const paidOrders = await prisma.order.findMany({
      where: { status: "PAID", closedAt: { gte: startOfDay } },
      include: { lines: true },
    });

    const revenue = paidOrders.reduce(
      (sum, o) => sum + o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0),
      0,
    );

    const activeTables = { active: true, zone: { active: true } };
    const [tablesFree, tablesOccupied, tablesBillRequested] = await Promise.all([
      prisma.table.count({ where: { ...activeTables, status: "FREE" } }),
      prisma.table.count({ where: { ...activeTables, status: "OCCUPIED" } }),
      prisma.table.count({ where: { ...activeTables, status: "BILL_REQUESTED" } }),
    ]);

    res.json({
      ordersToday: paidOrders.length,
      revenueToday: revenue,
      averageTicket: paidOrders.length ? revenue / paidOrders.length : 0,
      tables: { free: tablesFree, occupied: tablesOccupied, billRequested: tablesBillRequested },
    });
  }),
);
