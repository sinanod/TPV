import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";

let realtimeNamespace: ReturnType<SocketIOServer["of"]> | null = null;

export function initRealtime(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
  });

  realtimeNamespace = io.of("/realtime");
  realtimeNamespace.on("connection", (socket) => {
    socket.join("venue"); // sala única: un solo local por servidor
  });

  return io;
}

export function emitEvent(event: string, payload: unknown) {
  if (!realtimeNamespace) return;
  realtimeNamespace.to("venue").emit(event, payload);
}
