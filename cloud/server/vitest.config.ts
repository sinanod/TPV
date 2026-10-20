import path from "path";
import { defineConfig } from "vitest/config";

const certs = path.join(__dirname, "test", ".certs");

export default defineConfig({
  test: {
    globalSetup: ["./test/globalSetup.ts"],
    setupFiles: ["./test/setupEnv.ts"],
    fileParallelism: false,
    env: {
      TZ: "Europe/Madrid",
      SIF_PRODUCER_NAME: "Software TPV SL",
      SIF_PRODUCER_NIF: "B12345674",
      SIF_SYSTEM_ID: "TP",
      PAYMENT_PROVIDER: "demo",
      CERT_ENCRYPTION_KEY: "0".repeat(64),
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "2526",
      MAIL_FROM: "Tickets <tickets@tpv.test>",
      // Servidor AEAT simulado con mTLS (lo arranca billing.test.ts)
      AEAT_ENDPOINT_OVERRIDE: "https://127.0.0.1:8443/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
      AEAT_EXTRA_CA_FILE: path.join(certs, "ca.pem"),
    },
  },
});
