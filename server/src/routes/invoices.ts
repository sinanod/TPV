import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { h, HttpError } from "../http";
import { invoiceEmailRequested } from "../cloud/sync";
import { getSystemPrinters } from "../printing/agent";
import { printReceipt, printTestPage, retryPrintJob } from "../printing/service";

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

function dayRange(day: string | undefined) {
  const start = day ? new Date(`${day}T00:00:00`) : new Date();
  if (Number.isNaN(start.getTime())) throw new HttpError(400, "Fecha no válida (AAAA-MM-DD)");
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

// Tickets emitidos en un día (por defecto hoy), para reimprimir o enviar por email
invoicesRouter.get(
  "/invoices",
  h(async (req, res) => {
    const { start, end } = dayRange(typeof req.query.day === "string" ? req.query.day : undefined);
    const invoices = await prisma.invoice.findMany({
      where: { issuedAt: { gte: start, lt: end } },
      orderBy: { issuedAt: "desc" },
      include: { order: { include: { table: { include: { zone: true } }, payments: true } } },
    });
    res.json(
      invoices.map((i) => ({
        id: i.id,
        uuid: i.uuid,
        numSerie: i.numSerie,
        issuedAt: i.issuedAt,
        total: i.totalCents / 100,
        tableLabel: `${i.order.table.zone.name} · Mesa ${i.order.table.number}`,
        verifactu: i.chainSeq !== null,
        payments: i.order.payments
          .filter((p) => p.amount > 0)
          .map((p) => ({ method: p.method, amount: p.amount, email: p.email })),
      })),
    );
  }),
);

invoicesRouter.post(
  "/invoices/:id/print",
  h(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({ where: { id: Number(req.params.id) } });
    if (!invoice) throw new HttpError(404, "Ticket no encontrado");
    const result = await printReceipt(invoice.id);
    if (!result) throw new HttpError(409, "No hay impresora de tickets configurada");
    res.json(result);
  }),
);

invoicesRouter.post(
  "/invoices/:id/email",
  h(async (req, res) => {
    const parsed = z.object({ email: z.string().trim().email() }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Email no válido");
    const invoice = await prisma.invoice.findUnique({ where: { id: Number(req.params.id) } });
    if (!invoice) throw new HttpError(404, "Ticket no encontrado");
    if (!(await invoiceEmailRequested(invoice.uuid, parsed.data.email.toLowerCase()))) {
      throw new HttpError(409, "Para enviar tickets por email el TPV tiene que estar vinculado al portal");
    }
    res.status(202).json({ queued: true });
  }),
);

// ---------- Impresión ----------

invoicesRouter.get(
  "/printers",
  h(async (_req, res) => {
    const printers = await prisma.printer.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    res.json({ printers, systemPrinters: getSystemPrinters() });
  }),
);

invoicesRouter.post(
  "/printers/:id/test",
  h(async (req, res) => {
    const printer = await prisma.printer.findFirst({ where: { id: Number(req.params.id), active: true } });
    if (!printer) throw new HttpError(404, "Impresora no encontrada");
    res.json(await printTestPage(printer.id));
  }),
);

// Trabajos fallidos de las últimas 12 horas, para avisar y reintentar
invoicesRouter.get(
  "/print-jobs/failed",
  h(async (_req, res) => {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const jobs = await prisma.printJob.findMany({
      where: { status: "ERROR", updatedAt: { gte: since } },
      orderBy: { updatedAt: "desc" },
      include: { printer: { select: { name: true } } },
      take: 50,
    });
    res.json(
      jobs.map((j) => ({
        id: j.id,
        kind: j.kind,
        title: j.title,
        printerName: j.printer?.name ?? null,
        error: j.error,
        attempts: j.attempts,
        updatedAt: j.updatedAt,
      })),
    );
  }),
);

invoicesRouter.post(
  "/print-jobs/:id/retry",
  h(async (req, res) => {
    const job = await prisma.printJob.findUnique({ where: { id: Number(req.params.id) } });
    if (!job) throw new HttpError(404, "Trabajo de impresión no encontrado");
    res.json(await retryPrintJob(job.id));
  }),
);

invoicesRouter.post(
  "/print-jobs/:id/dismiss",
  h(async (req, res) => {
    const result = await prisma.printJob.updateMany({
      where: { id: Number(req.params.id), status: "ERROR" },
      data: { status: "DISMISSED" },
    });
    if (!result.count) throw new HttpError(404, "Trabajo de impresión no encontrado");
    res.status(204).end();
  }),
);
