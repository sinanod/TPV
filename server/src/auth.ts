import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./db";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

export interface AuthPayload {
  userId: number;
  name: string;
  role: "ADMIN" | "WAITER" | "KITCHEN";
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Falta token de autenticación" });
  }
  let payload: AuthPayload;
  try {
    payload = jwt.verify(header.slice("Bearer ".length), JWT_SECRET) as AuthPayload;
  } catch {
    return res.status(401).json({ error: "Token inválido o caducado" });
  }
  // Si el encargado da de baja a alguien en el portal, su sesión deja de
  // valer en cuanto llega la configuración, no a las 12 h.
  try {
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user?.active) return res.status(401).json({ error: "Usuario dado de baja" });
  } catch (e) {
    return next(e);
  }
  req.auth = payload;
  next();
}
