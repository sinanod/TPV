import { Request } from "express";
import { config } from "../config";

/** URL pública del portal: la configurada o, si no, la de la propia petición. */
export function publicBaseUrl(req: Request) {
  return config.publicBaseUrl ?? `${req.protocol}://${req.get("host")}`;
}
