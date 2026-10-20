import "dotenv/config";
import crypto from "crypto";

const isProduction = process.env.NODE_ENV === "production";
const env = (name: string) => process.env[name]?.trim() || undefined;

function jwtSecret(): string {
  const secret = env("JWT_SECRET");
  if (secret) return secret;
  if (isProduction) throw new Error("JWT_SECRET es obligatorio en producción");
  return "dev-only-secret";
}

/** Clave AES-256 para cifrar los certificados de la AEAT que suben los restaurantes. */
function certEncryptionKey(): Buffer | null {
  const hex = env("CERT_ENCRYPTION_KEY");
  if (hex) {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("CERT_ENCRYPTION_KEY debe tener 64 caracteres hexadecimales");
    return Buffer.from(hex, "hex");
  }
  if (isProduction) return null;
  return crypto.createHash("sha256").update("dev-only-cert-key").digest();
}

// Datos del productor del sistema informático de facturación (quien firma la
// declaración responsable). Van en cada registro VERI*FACTU.
function sifProducer() {
  const producerName = env("SIF_PRODUCER_NAME");
  const producerNif = env("SIF_PRODUCER_NIF");
  if (!producerName || !producerNif) return null;
  return {
    producerName,
    producerNif,
    systemName: (env("SIF_SYSTEM_NAME") ?? "TPV Restaurantes").slice(0, 30),
    systemId: (env("SIF_SYSTEM_ID") ?? "TR").slice(0, 2),
    version: env("SIF_VERSION") ?? "1.0.0",
  };
}

function smtp() {
  const host = env("SMTP_HOST");
  const from = env("MAIL_FROM");
  if (!host || !from) return null;
  return {
    host,
    port: Number(env("SMTP_PORT") ?? 587),
    secure: env("SMTP_SECURE") === "true",
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
    from,
  };
}

export const config = {
  isProduction,
  port: Number(process.env.PORT) || 8080,
  jwtSecret: jwtSecret(),
  corsOrigins: (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  /** URL pública del portal (QR de las mesas, enlaces de los emails). Si falta, se usa el host de la petición. */
  publicBaseUrl: env("PUBLIC_BASE_URL")?.replace(/\/+$/, "") ?? null,
  certEncryptionKey: certEncryptionKey(),
  sif: sifProducer(),
  smtp: smtp(),
  /** Pasarela para el pago desde el móvil: "demo" (solo pruebas, no cobra) o vacío (desactivado) */
  paymentProvider: env("PAYMENT_PROVIDER") ?? null,
  /** Solo tests: sustituye los endpoints de la AEAT y añade la CA de un servidor de pruebas */
  aeatEndpointOverride: env("AEAT_ENDPOINT_OVERRIDE") ?? null,
  aeatExtraCaFile: env("AEAT_EXTRA_CA_FILE") ?? null,
};

if (config.paymentProvider === "demo" && isProduction) {
  console.warn("[aviso] PAYMENT_PROVIDER=demo en producción: los pagos desde el móvil NO cobran dinero real");
}
