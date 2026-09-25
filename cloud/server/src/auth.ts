import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { NextFunction, Request, Response } from "express";
import { prisma } from "./db";
import { config } from "./config";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenantId?: string;
      deviceId?: string;
    }
  }
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

// Hash de relleno: con usuario inexistente se hace igualmente un bcrypt para
// que el tiempo de respuesta no revele qué usuarios existen.
const DUMMY_HASH = bcrypt.hashSync("dummy-password", 10);

/** Comprueba usuario/contraseña del restaurante. Devuelve null si no son válidos o la cuenta está desactivada. */
export async function authenticateTenant(username: string, password: string) {
  const tenant = await prisma.tenant.findUnique({ where: { username } });
  const valid = await verifyPassword(password, tenant?.passwordHash ?? DUMMY_HASH);
  if (!tenant || !valid || !tenant.active) return null;
  return tenant;
}

interface PortalTokenPayload {
  tenantId: string;
  kind: "portal";
}

export function signPortalToken(tenantId: string) {
  const payload: PortalTokenPayload = { tenantId, kind: "portal" };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "12h" });
}

/** Devuelve el tenantId si el token de portal es válido y el restaurante sigue activo. */
export async function verifyPortalToken(token: string): Promise<string | null> {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as PortalTokenPayload;
    if (payload.kind !== "portal") return null;
    const tenant = await prisma.tenant.findUnique({ where: { id: payload.tenantId } });
    return tenant?.active ? tenant.id : null;
  } catch {
    return null;
  }
}

export function generateDeviceToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashDeviceToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const LAST_SEEN_THROTTLE_MS = 30_000;

export async function verifyDeviceToken(token: string) {
  const device = await prisma.device.findUnique({
    where: { tokenHash: hashDeviceToken(token) },
    include: { tenant: true },
  });
  if (!device || device.revokedAt || !device.tenant.active) return null;

  if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  }
  return { deviceId: device.id, tenantId: device.tenantId };
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

export async function requirePortal(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req);
  const tenantId = token ? await verifyPortalToken(token) : null;
  if (!tenantId) return res.status(401).json({ error: "Sesión no válida o caducada" });
  req.tenantId = tenantId;
  next();
}

export async function requireDevice(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req);
  const device = token ? await verifyDeviceToken(token) : null;
  if (!device) return res.status(401).json({ error: "Dispositivo no autorizado" });
  req.tenantId = device.tenantId;
  req.deviceId = device.deviceId;
  next();
}
