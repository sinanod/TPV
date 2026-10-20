import nodemailer, { Transporter } from "nodemailer";
import { prisma } from "../db";
import { config } from "../config";
import { renderReceiptEmail } from "./receipt";

const MAX_ATTEMPTS = 5;
// Un ticket que no se ha podido mandar en una semana ya no tiene sentido enviarlo
const EXPIRE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

let transporter: Transporter | null = null;
function getTransporter() {
  if (!config.smtp) return null;
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transporter;
}

/** Encola el ticket para un email (idempotente por factura + destinatario). */
export async function queueReceiptEmail(tenantId: string, invoiceId: string, to: string) {
  await prisma.emailMessage.upsert({
    where: { invoiceId_to: { invoiceId, to: to.trim().toLowerCase() } },
    create: { tenantId, invoiceId, to: to.trim().toLowerCase() },
    update: {},
  });
}

type Json = Record<string, unknown>;

async function sendOne(id: string, smtp: Transporter) {
  const msg = await prisma.emailMessage.findUniqueOrThrow({
    where: { id },
    include: { invoice: true, tenant: { include: { settings: true } } },
  });
  if (Date.now() - msg.createdAt.getTime() > EXPIRE_AFTER_MS) {
    await prisma.emailMessage.update({ where: { id }, data: { status: "FAILED", lastError: "Caducado sin poder enviarse" } });
    return;
  }
  const inv = msg.invoice;
  const s = msg.tenant.settings;
  const email = await renderReceiptEmail({
    businessName: s?.tradeName || msg.tenant.name,
    legalName: s?.legalName || msg.tenant.name,
    nif: s?.nif ?? "",
    address: s?.address ?? "",
    footer: s?.ticketFooter ?? "",
    showTradeName: s?.ticketShowTradeName ?? true,
    headerText: s?.ticketHeaderText ?? "",
    showTable: s?.ticketShowTable ?? true,
    logo: s?.ticketLogo ? Buffer.from(s.ticketLogo) : null,
    numSerie: inv.numSerie,
    issuedAt: inv.issuedAt,
    tableLabel: inv.tableLabel,
    lines: (inv.lines as Json[]).map((l) => ({ name: String(l.name), qty: Number(l.qty), totalCents: Number(l.totalCents) })),
    breakdown: inv.breakdown as { rate: number; baseCents: number; quotaCents: number }[],
    totalCents: inv.totalCents,
    payments: (inv.payments as Json[])
      .map((p) => ({ method: String(p.method), amountCents: Number(p.amountCents) }))
      .filter((p) => p.amountCents > 0),
    qrUrl: inv.qrUrl,
  });
  try {
    await smtp.sendMail({ from: config.smtp!.from, to: msg.to, ...email });
    await prisma.emailMessage.update({
      where: { id },
      data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
    });
  } catch (e) {
    const attempts = msg.attempts + 1;
    await prisma.emailMessage.update({
      where: { id },
      data: {
        attempts,
        lastError: e instanceof Error ? e.message : String(e),
        status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
      },
    });
  }
}

let running = false;

export async function runEmailSender() {
  const smtp = getTransporter();
  // Sin SMTP configurado se quedan en cola: se enviarán al configurarlo
  if (!smtp || running) return;
  running = true;
  try {
    const pending = await prisma.emailMessage.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const m of pending) await sendOne(m.id, smtp).catch((e) => console.error("[email]", m.id, e));
  } finally {
    running = false;
  }
}

export function startEmailSender(intervalMs = 15_000) {
  return setInterval(() => void runEmailSender(), intervalMs);
}
