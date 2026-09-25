import { io, Socket } from "socket.io-client";
import { getToken, notifyUnauthorized } from "./api";

export type RealtimeEvent = "live:updated" | "config:updated" | "devices:updated";

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io("/portal", { auth: { token: getToken() ?? "" } });
    socket.on("connect_error", (err) => {
      if (err.message === "unauthorized") notifyUnauthorized();
    });
  }
  return socket;
}

export function disconnectRealtime() {
  socket?.disconnect();
  socket = null;
}

export function subscribe(events: RealtimeEvent[], handler: () => void): () => void {
  const s = getSocket();
  for (const e of events) s.on(e, handler);
  // Los eventos emitidos mientras estábamos desconectados se pierden: al reconectar se recarga todo.
  s.io.on("reconnect", handler);
  return () => {
    for (const e of events) s.off(e, handler);
    s.io.off("reconnect", handler);
  };
}
