import express from "express";
import cors from "cors";
import helmet from "helmet";
import fs from "fs";
import path from "path";
import { config } from "./config";
import { prisma } from "./db";
import { errorHandler, h } from "./lib/http";
import { authRouter } from "./routes/auth";
import { portalRouter } from "./routes/portal";
import { adminRouter } from "./routes/admin";
import { syncRouter } from "./routes/sync";

export function createApp() {
  const app = express();

  // Azure App Service termina TLS en su proxy: sin esto req.ip sería la IP
  // del proxy y el rate limit trataría a todos los clientes como uno.
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    }),
  );
  if (config.corsOrigins.length) app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: "2mb" }));

  app.get(
    "/api/health",
    h(async (_req, res) => {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    }),
  );
  app.use("/api/auth", authRouter);
  app.use("/api/portal", portalRouter);
  app.use("/api/portal", adminRouter);
  app.use("/api/sync", syncRouter);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

  const portalDist = path.join(__dirname, "..", "..", "portal", "dist");
  if (fs.existsSync(portalDist)) {
    app.use(express.static(portalDist));
    app.get("*", (_req, res) => res.sendFile(path.join(portalDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
