import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db";
import { authenticateTenant, requirePortal, signPortalToken } from "../auth";
import { h, HttpError } from "../lib/http";

export const authRouter = Router();

// Frena ataques de fuerza bruta contra las contraseñas de los restaurantes.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Vuelve a probar en unos minutos." },
});

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  loginLimiter,
  h(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const tenant = await authenticateTenant(username, password);
    if (!tenant) throw new HttpError(401, "Usuario o contraseña incorrectos");
    res.json({
      token: signPortalToken(tenant.id),
      tenant: { id: tenant.id, name: tenant.name, username: tenant.username },
    });
  }),
);

authRouter.get(
  "/me",
  requirePortal,
  h(async (req, res) => {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: req.tenantId } });
    res.json({ id: tenant.id, name: tenant.name, username: tenant.username });
  }),
);
