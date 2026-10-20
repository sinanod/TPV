const { BrowserWindow } = require("electron");
const { io } = require("socket.io-client");

// Agente de impresión: imprime en las impresoras instaladas en este PC (USB o
// compartidas) los documentos que manda el servidor local, usando el driver
// del sistema operativo. El servidor solo acepta agentes con el token que
// esta app le pasó al arrancarlo.

const PRINTERS_REFRESH_MS = 60_000;

function startPrintAgent({ serverUrl, token, window }) {
  const socket = io(`${serverUrl}/print-agent`, { auth: { token }, transports: ["websocket"] });
  let lastReported = "";

  async function systemPrinters() {
    const printers = await window.webContents.getPrintersAsync();
    return printers.map((p) => p.name).sort();
  }

  async function reportPrinters() {
    const names = await systemPrinters();
    const key = JSON.stringify(names);
    if (key === lastReported) return;
    lastReported = key;
    socket.emit("printers", names);
  }

  socket.on("connect", () => {
    lastReported = "";
    reportPrinters().catch((e) => console.error("[impresión] no se pudieron listar las impresoras", e));
  });
  const timer = setInterval(() => reportPrinters().catch(() => {}), PRINTERS_REFRESH_MS);

  socket.on("print", async ({ printerName, html }, ack) => {
    try {
      if (!(await systemPrinters()).includes(printerName)) {
        return ack({ ok: false, error: `La impresora «${printerName}» no está instalada en este equipo` });
      }
      const job = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
      await job.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`);
      job.webContents.print(
        { silent: true, deviceName: printerName, printBackground: true, margins: { marginType: "none" }, preferCSSPageSize: true },
        (success, failureReason) => {
          job.destroy();
          ack(success ? { ok: true } : { ok: false, error: failureReason || "Error de impresión" });
        },
      );
    } catch (e) {
      ack({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  return () => {
    clearInterval(timer);
    socket.disconnect();
  };
}

module.exports = { startPrintAgent };
