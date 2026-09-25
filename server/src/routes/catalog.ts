import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../auth";

export const catalogRouter = Router();

catalogRouter.use(requireAuth);

catalogRouter.get("/categories", async (_req, res) => {
  const categories = await prisma.category.findMany({
    include: { products: { orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });
  res.json(categories);
});
