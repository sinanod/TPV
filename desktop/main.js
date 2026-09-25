const { app, BrowserWindow } = require("electron");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const SERVER_PORT = process.env.TPV_SERVER_PORT || "4000";
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

let serverProcess = null;
let mainWindow = null;

function resolveServerDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "server")
    : path.join(__dirname, "..", "server");
}

function startServer() {
  const serverDir = resolveServerDir();
  const command = app.isPackaged ? process.execPath : "npx";
  const args = app.isPackaged
    ? [path.join(serverDir, "dist", "index.js")]
    : ["tsx", "src/index.ts"];

  serverProcess = spawn(command, args, {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: SERVER_PORT,
      ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  serverProcess.on("exit", (code) => {
    console.log(`[tpv-desktop] servidor terminado (código ${code})`);
  });
}

async function waitForServer(retries = 60) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`);
      if (res.ok) return true;
    } catch {
      // el servidor aún no ha levantado; reintentamos
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === "IPv4" && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

function injectLanBadge() {
  const lanAddresses = getLanAddresses();
  const message = lanAddresses.length
    ? `App Android / navegador: ${lanAddresses.map((ip) => `http://${ip}:${SERVER_PORT}`).join("  ·  ")}`
    : "Sin red local detectada: la app Android no podrá conectarse";

  mainWindow.webContents
    .executeJavaScript(
      `(function(){
        var el = document.createElement("div");
        el.textContent = ${JSON.stringify(message)};
        Object.assign(el.style, {
          position: "fixed", bottom: "0", left: "0", right: "0",
          background: "#0d1420", color: "#9aa4b2", fontSize: "11px",
          padding: "4px 10px", fontFamily: "monospace", zIndex: "9999",
          textAlign: "center"
        });
        document.body.appendChild(el);
      })();`,
    )
    .catch(() => {});
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "TPV — Servidor local",
    webPreferences: { contextIsolation: true },
  });

  const ready = await waitForServer();
  if (!ready) {
    await mainWindow.loadURL(
      "data:text/html,<h1 style='font-family:sans-serif;padding:2rem'>No se pudo arrancar el servidor TPV.</h1>",
    );
    return;
  }

  await mainWindow.loadURL(SERVER_URL);
  injectLanBadge();
}

app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) serverProcess.kill();
});
