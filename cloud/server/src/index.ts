import { createServer } from "http";
import { config } from "./config";
import { createApp } from "./app";
import { initRealtime } from "./realtime";

const httpServer = createServer(createApp());
initRealtime(httpServer);

httpServer.listen(config.port, () => {
  console.log(`TPV cloud escuchando en el puerto ${config.port}`);
});
