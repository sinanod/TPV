import { io, Socket } from "socket.io-client";
import { getServerUrl } from "./config";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(`${getServerUrl()}/realtime`, { transports: ["websocket"] });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
