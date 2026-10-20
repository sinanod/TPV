import net from "net";

/** Envía bytes en bruto a una impresora de red (ESC/POS, normalmente puerto 9100). */
export function sendRaw(host: string, port: number, data: Buffer, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail(`La impresora ${host}:${port} no responde`), timeoutMs);

    socket.on("connect", () => socket.end(data));
    socket.on("error", (e) => {
      clearTimeout(timer);
      fail(`No se pudo conectar con la impresora ${host}:${port} (${e.message})`);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve();
      }
    });
  });
}
