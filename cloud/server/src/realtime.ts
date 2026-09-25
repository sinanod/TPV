import { Server as HttpServer } from "http";
import { Namespace, Server } from "socket.io";
import { prisma } from "./db";
import { config } from "./config";
import { verifyDeviceToken, verifyPortalToken } from "./auth";

// Salas: `t:<tenantId>` agrupa a todos los sockets de un restaurante, así un
// restaurante nunca recibe eventos de otro. `d:<deviceId>` permite
// desconectar un dispositivo concreto al revocarlo.

let portalNs: Namespace | null = null;
let deviceNs: Namespace | null = null;

// Conexiones abiertas por dispositivo (un servidor local puede reconectar
// antes de que se cierre el socket anterior). En memoria: vale para una
// única instancia; para escalar horizontalmente haría falta el adaptador
// Redis de Socket.IO.
const onlineDevices = new Map<string, number>();

export function isDeviceOnline(deviceId: string) {
  return (onlineDevices.get(deviceId) ?? 0) > 0;
}

export function initRealtime(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: config.corsOrigins.length ? { origin: config.corsOrigins } : undefined,
  });

  portalNs = io.of("/portal");
  portalNs.use(async (socket, next) => {
    const tenantId = await verifyPortalToken(String(socket.handshake.auth?.token ?? ""));
    if (!tenantId) return next(new Error("unauthorized"));
    socket.data.tenantId = tenantId;
    next();
  });
  portalNs.on("connection", (socket) => {
    socket.join(`t:${socket.data.tenantId}`);
  });

  deviceNs = io.of("/device");
  deviceNs.use(async (socket, next) => {
    const device = await verifyDeviceToken(String(socket.handshake.auth?.token ?? ""));
    if (!device) return next(new Error("unauthorized"));
    socket.data.tenantId = device.tenantId;
    socket.data.deviceId = device.deviceId;
    next();
  });
  deviceNs.on("connection", (socket) => {
    const { tenantId, deviceId } = socket.data as { tenantId: string; deviceId: string };
    socket.join(`t:${tenantId}`);
    socket.join(`d:${deviceId}`);
    onlineDevices.set(deviceId, (onlineDevices.get(deviceId) ?? 0) + 1);
    emitToPortal(tenantId, "devices:updated");

    socket.on("disconnect", async () => {
      const remaining = (onlineDevices.get(deviceId) ?? 1) - 1;
      if (remaining > 0) onlineDevices.set(deviceId, remaining);
      else onlineDevices.delete(deviceId);
      await prisma.device
        .update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } })
        .catch(() => {});
      emitToPortal(tenantId, "devices:updated");
    });
  });

  return io;
}

export function emitToPortal(tenantId: string, event: string, payload: unknown = {}) {
  portalNs?.to(`t:${tenantId}`).emit(event, payload);
}

export function emitToDevices(tenantId: string, event: string, payload: unknown = {}) {
  deviceNs?.to(`t:${tenantId}`).emit(event, payload);
}

export function disconnectDevice(deviceId: string) {
  deviceNs?.in(`d:${deviceId}`).disconnectSockets(true);
}
