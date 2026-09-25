import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (isProduction) throw new Error("JWT_SECRET es obligatorio en producción");
  return "dev-only-secret";
}

export const config = {
  isProduction,
  port: Number(process.env.PORT) || 8080,
  jwtSecret: jwtSecret(),
  corsOrigins: (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
};
