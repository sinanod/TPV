import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { errorHandler } from "./http";
import { authRouter } from "./routes/auth";
import { setupRouter } from "./routes/setup";
import { tablesRouter } from "./routes/tables";
import { catalogRouter } from "./routes/catalog";
import { ordersRouter } from "./routes/orders";
import { dashboardRouter } from "./routes/dashboard";
import { invoicesRouter } from "./routes/invoices";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter);
  // Antes de los routers con requireAuth: estos aplican el middleware a todo
  // lo que pasa por /api.
  app.use("/api/setup", setupRouter);
  app.use("/api", tablesRouter);
  app.use("/api", catalogRouter);
  app.use("/api", ordersRouter);
  app.use("/api", dashboardRouter);
  app.use("/api", invoicesRouter);

  // Si existe el build de la interfaz del TPV (web/dist), el propio servidor la
  // sirve: la app de escritorio solo necesita abrir su propia URL.
  const webDist = path.join(__dirname, "..", "..", "web", "dist");
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
