import crypto from "crypto";
import { Namespace, Server, Socket } from "socket.io";

// Agente de impresión: la app de escritorio se conecta aquí y imprime con el
// driver del sistema operativo en las impresoras USB/instaladas en el PC. El
// token lo genera la app de escritorio al arrancar este servidor.

let namespace: Namespace | null = null;
let systemPrinters: string[] = [];
let onPrintersChanged: ((names: string[]) => void) | null = null;

export function onSystemPrintersChanged(cb: (names: string[]) => void) {
  onPrintersChanged = cb;
}

export function getSystemPrinters() {
  return systemPrinters;
}

function tokenMatches(given: unknown, expected: string) {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function initPrintAgent(io: Server) {
  const expected = process.env.PRINT_AGENT_TOKEN;
  namespace = io.of("/print-agent");
  namespace.use((socket, next) => {
    if (!expected || !tokenMatches(socket.handshake.auth?.token, expected)) return next(new Error("unauthorized"));
    next();
  });
  namespace.on("connection", (socket: Socket) => {
    socket.on("printers", (names: unknown) => {
      if (!Array.isArray(names)) return;
      systemPrinters = names.filter((n): n is string => typeof n === "string").sort();
      onPrintersChanged?.(systemPrinters);
    });
  });
}

export async function printWithAgent(printerName: string, html: string, widthMm: number): Promise<void> {
  const agent = namespace ? [...namespace.sockets.values()][0] : undefined;
  if (!agent) {
    throw new Error("No hay agente de impresión conectado: abre la app de escritorio del TPV en este equipo");
  }
  let result: { ok: boolean; error?: string };
  try {
    result = await agent.timeout(30_000).emitWithAck("print", { printerName, html, widthMm });
  } catch {
    throw new Error(`La impresora «${printerName}» no ha respondido a tiempo`);
  }
  if (!result?.ok) throw new Error(result?.error || `No se pudo imprimir en «${printerName}»`);
}
