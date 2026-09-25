import os from "os";
import { Router } from "express";
import { z } from "zod";
import { h, HttpError } from "../http";
import { cloudStatus, linkToCloud, syncNow, unlinkFromCloud } from "../cloud/sync";

// Vinculación con el portal. No usa el PIN del TPV: la prueba de propiedad
// son las credenciales del restaurante en la nube.
export const setupRouter = Router();

setupRouter.get(
  "/cloud",
  h(async (_req, res) => {
    res.json(await cloudStatus());
  }),
);

const linkSchema = z.object({
  cloudUrl: z.string().trim().min(1),
  username: z.string().trim().min(1),
  password: z.string().min(1),
  deviceName: z.string().trim().min(1).max(100).optional(),
});

setupRouter.post(
  "/cloud/link",
  h(async (req, res) => {
    const parsed = linkSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Indica la dirección del portal, el usuario y la contraseña");
    const { deviceName, ...rest } = parsed.data;
    res.json(await linkToCloud({ ...rest, deviceName: deviceName || os.hostname() }));
  }),
);

setupRouter.post(
  "/cloud/unlink",
  h(async (req, res) => {
    const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Indica la contraseña del restaurante");
    await unlinkFromCloud(parsed.data.password);
    res.json(await cloudStatus());
  }),
);

setupRouter.post(
  "/cloud/sync",
  h(async (_req, res) => {
    res.json(await syncNow());
  }),
);
