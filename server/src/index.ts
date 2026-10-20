import "dotenv/config";
import { createServer } from "http";
import { createApp } from "./app";
import { initRealtime } from "./realtime";
import { devicePrintersChanged, startSync } from "./cloud/sync";
import { initPrintAgent, onSystemPrintersChanged } from "./printing/agent";

const httpServer = createServer(createApp());
const io = initRealtime(httpServer);
initPrintAgent(io);
onSystemPrintersChanged((names) => void devicePrintersChanged(names));

const port = Number(process.env.PORT) || 4000;
httpServer.listen(port, () => {
  console.log(`TPV server escuchando en http://0.0.0.0:${port}`);
  startSync().catch((e) => console.error("[nube] no se pudo iniciar la sincronización", e));
});
