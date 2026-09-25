import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { AuthPayload, signToken } from "../auth";
import { h, HttpError } from "../http";

export const authRouter = Router();

const loginSchema = z.object({ pin: z.string().min(1) });

authRouter.post(
  "/login",
  h(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "PIN requerido");

    const user = await prisma.user.findFirst({ where: { pin: parsed.data.pin, active: true } });
    if (!user) throw new HttpError(401, "PIN incorrecto");

    const role = user.role as AuthPayload["role"];
    res.json({
      token: signToken({ userId: user.id, name: user.name, role }),
      user: { id: user.id, name: user.name, role },
    });
  }),
);
