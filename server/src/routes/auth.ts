import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { signToken } from "../auth";

export const authRouter = Router();

const loginSchema = z.object({ pin: z.string().min(1) });

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "PIN requerido" });
  }

  const user = await prisma.user.findUnique({ where: { pin: parsed.data.pin } });
  if (!user) {
    return res.status(401).json({ error: "PIN incorrecto" });
  }

  const token = signToken({ userId: user.id, name: user.name, role: user.role });
  res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role },
  });
});
