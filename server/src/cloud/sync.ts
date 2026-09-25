import { io, Socket } from "socket.io-client";
import { prisma } from "../db";
import { HttpError } from "../http";
import { emitEvent } from "../realtime";
import { CloudError, cloudRequest, normalizeCloudUrl } from "./client";
import { applyConfig, ConfigSnapshot } from "./config";
import { enqueueOrder, enqueueSnapshot, enqueueTable } from "./outbox";

const FLUSH_INTERVAL_MS = 10_000;
// Red de seguridad por si se pierde algún aviso `config:updated` por socket
const CONFIG_POLL_INTERVAL_MS = 5 * 60_000;
const BATCH_SIZE = 200;
const OPEN_STATUSES = ["OPEN", "SENT", "SERVED"];

const state = { connected: false, flushing: false, pulling: false, pullAgain: false };
let socket: Socket | null = null;
let timers: NodeJS.Timeout[] = [];
let kickTimer: NodeJS.Timeout | null = null;

const getLink = () => prisma.cloudLink.findUnique({ where: { id: 1 } });

async function setError(message: string | null) {
  await prisma.cloudLink.updateMany({ where: { id: 1 }, data: { lastError: message } });
}

function describe(e: unknown) {
  if (e instanceof CloudError && e.status === 401) {
    return "La nube ha rechazado este TPV: el dispositivo se ha revocado o la cuenta está desactivada";
  }
  return e instanceof Error ? e.message : String(e);
}

// ---------- Subida de eventos ----------

async function flush() {
  if (state.flushing) return;
  state.flushing = true;
  try {
    const link = await getLink();
    if (!link) return;
    for (;;) {
      const batch = await prisma.outboxEvent.findMany({
        orderBy: [{ at: "asc" }, { createdAt: "asc" }],
        take: BATCH_SIZE,
      });
      if (!batch.length) break;

      const result = await cloudRequest<{ accepted: string[]; rejected: { id: string | null; error: string }[] }>(
        link.cloudUrl,
        "/api/sync/events",
        {
          method: "POST",
          token: link.deviceToken,
          body: {
            events: batch.map((e) => ({ id: e.id, type: e.type, at: e.at.toISOString(), data: JSON.parse(e.data) })),
          },
        },
      );
      for (const r of result.rejected) console.warn(`[nube] evento ${r.id} rechazado: ${r.error}`);

      const processed = [...result.accepted, ...result.rejected.map((r) => r.id).filter((id): id is string => !!id)];
      await prisma.outboxEvent.deleteMany({ where: { id: { in: processed } } });
      await prisma.cloudLink.updateMany({ where: { id: 1 }, data: { lastSyncAt: new Date(), lastError: null } });
      if (!processed.length || batch.length < BATCH_SIZE) break;
    }
  } catch (e) {
    await setError(describe(e));
  } finally {
    state.flushing = false;
  }
}

function kick() {
  if (kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    void flush();
  }, 300);
}

// ---------- Bajada de configuración ----------

async function pullConfig() {
  if (state.pulling) {
    state.pullAgain = true;
    return;
  }
  state.pulling = true;
  try {
    do {
      state.pullAgain = false;
      const link = await getLink();
      if (!link) return;
      const snapshot = await cloudRequest<ConfigSnapshot>(link.cloudUrl, "/api/sync/config", { token: link.deviceToken });
      if (snapshot.version !== link.configVersion) {
        await applyConfig(snapshot);
        emitEvent("config:updated", { version: snapshot.version });
      }
    } while (state.pullAgain);
  } catch (e) {
    await setError(describe(e));
  } finally {
    state.pulling = false;
  }
}

// ---------- Ciclo de vida ----------

async function onConnected() {
  await setError(null);
  await pullConfig();
  await enqueueSnapshot();
  await flush();
}

export async function startSync() {
  stopSync();
  const link = await getLink();
  if (!link) return;

  socket = io(`${link.cloudUrl}/device`, {
    auth: { token: link.deviceToken },
    transports: ["websocket"],
    reconnectionDelayMax: 30_000,
  });
  socket.on("connect", () => {
    state.connected = true;
    void onConnected();
  });
  socket.on("disconnect", () => {
    state.connected = false;
  });
  socket.on("connect_error", (err) => {
    state.connected = false;
    void setError(
      err.message === "unauthorized"
        ? "La nube ha rechazado este TPV: el dispositivo se ha revocado o la cuenta está desactivada"
        : "Sin conexión con la nube (el TPV sigue funcionando y sincronizará al volver)",
    );
  });
  socket.on("config:updated", () => void pullConfig());

  timers = [setInterval(() => void flush(), FLUSH_INTERVAL_MS), setInterval(() => void pullConfig(), CONFIG_POLL_INTERVAL_MS)];
}

export function stopSync() {
  socket?.disconnect();
  socket = null;
  state.connected = false;
  timers.forEach(clearInterval);
  timers = [];
}

// ---------- Llamadas desde las rutas del TPV ----------
// Nunca deben romper la operación del TPV: si algo falla se registra y el
// TPV sigue.

export async function tableChanged(tableId: number) {
  try {
    if (!(await getLink())) return;
    if (await enqueueTable(tableId)) kick();
  } catch (e) {
    console.error("[nube] no se pudo encolar la mesa", e);
  }
}

export async function orderChanged(orderId: number) {
  try {
    if (!(await getLink())) return;
    if (await enqueueOrder(orderId)) kick();
  } catch (e) {
    console.error("[nube] no se pudo encolar la comanda", e);
  }
}

// ---------- Vinculación ----------

export async function cloudStatus() {
  const link = await getLink();
  if (!link) return { linked: false as const };
  return {
    linked: true as const,
    cloudUrl: link.cloudUrl,
    tenantName: link.tenantName,
    deviceName: link.deviceName,
    connected: state.connected,
    configVersion: link.configVersion,
    lastConfigAt: link.lastConfigAt,
    lastSyncAt: link.lastSyncAt,
    lastError: link.lastError,
    pendingEvents: await prisma.outboxEvent.count(),
  };
}

function toHttpError(e: unknown): never {
  if (e instanceof CloudError) {
    if (e.status === 0) throw new HttpError(503, e.message);
    if (e.status === 401) throw new HttpError(401, "Usuario o contraseña incorrectos");
    if (e.status === 400) throw new HttpError(400, e.message);
    throw new HttpError(502, e.message);
  }
  throw e;
}

export async function linkToCloud(input: { cloudUrl: string; username: string; password: string; deviceName: string }) {
  if (await getLink()) throw new HttpError(409, "Este TPV ya está vinculado. Desvincúlalo antes de vincularlo a otra cuenta.");
  if (await prisma.order.count({ where: { status: { in: OPEN_STATUSES } } })) {
    throw new HttpError(
      409,
      "Cobra o cierra todas las mesas abiertas antes de vincular: la carta, las mesas y el personal se sustituirán por los del portal.",
    );
  }

  let cloudUrl: string;
  let registration: { deviceId: string; deviceToken: string; tenant: { id: string; name: string; username: string } };
  try {
    cloudUrl = normalizeCloudUrl(input.cloudUrl);
    registration = await cloudRequest(cloudUrl, "/api/sync/register", {
      method: "POST",
      body: { username: input.username, password: input.password, deviceName: input.deviceName },
    });
  } catch (e) {
    toHttpError(e);
  }

  await prisma.outboxEvent.deleteMany();
  await prisma.cloudLink.create({
    data: {
      id: 1,
      cloudUrl,
      deviceToken: registration.deviceToken,
      deviceId: registration.deviceId,
      deviceName: input.deviceName,
      tenantId: registration.tenant.id,
      tenantName: registration.tenant.name,
      username: registration.tenant.username,
    },
  });
  await pullConfig();
  await startSync();
  return cloudStatus();
}

export async function unlinkFromCloud(password: string) {
  const link = await getLink();
  if (!link) throw new HttpError(409, "Este TPV no está vinculado");

  // Desvincular exige la contraseña del restaurante: cualquiera en la WiFi
  // del local puede llegar a este servidor.
  let portalToken: string;
  try {
    ({ token: portalToken } = await cloudRequest<{ token: string }>(link.cloudUrl, "/api/auth/login", {
      method: "POST",
      body: { username: link.username, password },
    }));
  } catch (e) {
    if (e instanceof CloudError && e.status === 0) {
      throw new HttpError(503, "Sin conexión con la nube: no se puede comprobar la contraseña");
    }
    if (e instanceof CloudError && e.status === 401) throw new HttpError(401, "Contraseña incorrecta");
    toHttpError(e);
  }

  await flush();
  await cloudRequest(link.cloudUrl, `/api/portal/devices/${link.deviceId}`, { method: "DELETE", token: portalToken }).catch(
    () => {},
  );
  stopSync();
  await prisma.outboxEvent.deleteMany();
  await prisma.cloudLink.delete({ where: { id: 1 } });
}

export async function syncNow() {
  await pullConfig();
  await flush();
  return cloudStatus();
}
