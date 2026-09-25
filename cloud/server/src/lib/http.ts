import { NextFunction, Request, RequestHandler, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Express 4 no captura promesas rechazadas: sin esto un error async tumba el proceso. */
export function h(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Datos no válidos", details: err.flatten().fieldErrors });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Ya existe un elemento con ese nombre, número o PIN" });
    }
    if (err.code === "P2003" || err.code === "P2014") {
      return res.status(409).json({ error: "No se puede borrar: tiene elementos asociados" });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: "No encontrado" });
    }
  }
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
}
