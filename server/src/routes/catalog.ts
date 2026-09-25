import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { h } from "../http";

export const catalogRouter = Router();

catalogRouter.use(requireAuth);

catalogRouter.get(
  "/categories",
  h(async (_req, res) => {
    const categories = await prisma.category.findMany({
      where: { active: true },
      include: {
        products: {
          where: { active: true, available: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    res.json(categories);
  }),
);
