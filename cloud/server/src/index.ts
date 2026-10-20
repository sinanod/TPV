import { createServer } from "http";
import { config } from "./config";
import { createApp } from "./app";
import { initRealtime } from "./realtime";
import { startAeatSender } from "./aeat/sender";
import { startEmailSender } from "./email/sender";

const httpServer = createServer(createApp());
initRealtime(httpServer);

httpServer.listen(config.port, () => {
  console.log(`TPV cloud escuchando en el puerto ${config.port}`);
  startAeatSender();
  startEmailSender();
  if (!config.smtp) console.warn("[aviso] SMTP no configurado: los tickets por email quedan en cola");
  if (!config.sif) console.warn("[aviso] Faltan SIF_PRODUCER_NAME/SIF_PRODUCER_NIF: no se podrá activar VERI*FACTU");
});
