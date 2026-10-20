// Documento de impresión independiente de la impresora: se traduce a ESC/POS
// (impresoras de red) o a HTML (impresoras del sistema vía la app de
// escritorio).

import type { TicketDesign, TicketLogoInfo } from "../settings";
import type { TicketLogo } from "./logo";

export type Block =
  | { t: "text"; text: string; align?: "left" | "center" | "right"; bold?: boolean; large?: boolean }
  | { t: "row"; left: string; right: string; bold?: boolean; large?: boolean }
  | { t: "rule" }
  | { t: "qr"; data: string }
  // Solo la referencia al logo: el documento se guarda en JSON para poder reimprimirlo
  | { t: "image"; logo: TicketLogoInfo }
  | { t: "feed"; lines?: number };

export interface PrintDocument {
  blocks: Block[];
}

/** Documento listo para la impresora, con la imagen del logo ya cargada. */
export type ResolvedBlock = Exclude<Block, { t: "image" }> | { t: "image"; logo: TicketLogo };
export interface ResolvedDocument {
  blocks: ResolvedBlock[];
}

export function euros(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const int = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${int},${String(abs % 100).padStart(2, "0")} €`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateTime = (d: Date) =>
  `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const time = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const PAYMENT_LABEL: Record<string, string> = { CASH: "Efectivo", CARD: "Tarjeta", ONLINE: "Pago móvil" };
export const paymentLabel = (method: string) => PAYMENT_LABEL[method] ?? method;

// ---------- Comanda para cocina/barra ----------

export interface KitchenTicketInput {
  printerName: string;
  tableLabel: string;
  waiterName: string;
  at: Date;
  lines: { qty: number; name: string; note: string | null }[];
}

export function kitchenTicket(input: KitchenTicketInput): PrintDocument {
  return {
    blocks: [
      { t: "text", text: input.printerName.toUpperCase(), align: "center", bold: true, large: true },
      { t: "text", text: input.tableLabel, align: "center", bold: true, large: true },
      { t: "text", text: `${input.waiterName} · ${time(input.at)}`, align: "center" },
      { t: "rule" },
      ...input.lines.flatMap((l): Block[] => [
        { t: "text", text: `${l.qty} x ${l.name}`, bold: true, large: true },
        ...(l.note ? [{ t: "text", text: `   > ${l.note}` } as Block] : []),
      ]),
      { t: "rule" },
      { t: "feed", lines: 2 },
    ],
  };
}

// ---------- Factura simplificada (ticket del cliente) ----------

export interface BusinessHeader {
  name: string;
  legalName: string;
  nif: string;
  address: string;
  ticketFooter: string;
}

/** Cabecera configurable del restaurante: logo, nombre, datos fiscales y texto libre */
export interface TicketHeader {
  business: BusinessHeader | null;
  design: TicketDesign;
}

export interface ReceiptInput extends TicketHeader {
  numSerie: string;
  issuedAt: Date;
  tableLabel: string;
  waiterName: string;
  lines: { qty: number; name: string; totalCents: number }[];
  breakdown: { rate: number; baseCents: number; quotaCents: number }[];
  totalCents: number;
  payments: { method: string; amountCents: number; tenderedCents: number | null }[];
  /** URL del QR tributario; null si el restaurante no usa VERI*FACTU */
  qrUrl: string | null;
}

const centered = (text: string): Block[] =>
  text
    .split("\n")
    .filter(Boolean)
    .map((line): Block => ({ t: "text", text: line, align: "center" }));

function headerBlocks({ business: b, design }: TicketHeader): Block[] {
  const logo = design.logo;
  // Sin logo el nombre comercial se muestra siempre: el ticket tiene que decir de quién es
  const showName = design.showTradeName || !logo;
  return [
    ...(logo ? [{ t: "image", logo } as Block, { t: "feed" } as Block] : []),
    ...(b && showName ? [{ t: "text", text: b.name, align: "center", bold: true, large: true } as Block] : []),
    // Razón social y NIF son obligatorios en la factura: no se pueden ocultar
    ...(b && b.legalName && (b.legalName !== b.name || !showName) ? centered(b.legalName) : []),
    ...(b ? centered(`NIF ${b.nif}`) : []),
    ...(b?.address ? centered(b.address) : []),
    ...centered(design.headerText),
  ];
}

const footerBlocks = (design: TicketDesign): Block[] =>
  design.footer ? [{ t: "feed" }, ...centered(design.footer)] : [];

export function receipt(input: ReceiptInput): PrintDocument {
  // El QR tributario va al principio de la factura, con «QR tributario:»
  // encima y la leyenda VERI*FACTU debajo (especificaciones del QR v0.5.0).
  const qr: Block[] = input.qrUrl
    ? [
        { t: "text", text: "QR tributario:", align: "center" },
        { t: "qr", data: input.qrUrl },
        { t: "text", text: "VERI*FACTU", align: "center", bold: true },
        { t: "feed" },
      ]
    : [];

  const change = input.payments.reduce(
    (s, p) => s + (p.tenderedCents !== null ? p.tenderedCents - p.amountCents : 0),
    0,
  );

  const who = [input.design.showTable && input.tableLabel, input.design.showWaiter && input.waiterName].filter(Boolean);

  return {
    blocks: [
      ...qr,
      ...headerBlocks(input),
      { t: "rule" },
      { t: "text", text: "FACTURA SIMPLIFICADA", bold: true },
      { t: "row", left: `Nº ${input.numSerie}`, right: dateTime(input.issuedAt) },
      ...(who.length ? [{ t: "text", text: who.join(" · ") } as Block] : []),
      { t: "rule" },
      ...input.lines.map((l): Block => ({ t: "row", left: `${l.qty} x ${l.name}`, right: euros(l.totalCents) })),
      { t: "rule" },
      { t: "row", left: "TOTAL", right: euros(input.totalCents), bold: true, large: true },
      ...input.breakdown.map(
        (b): Block => ({
          t: "row",
          left: `IVA ${b.rate}% s/ ${euros(b.baseCents)}`,
          right: euros(b.quotaCents),
        }),
      ),
      { t: "rule" },
      ...input.payments.map((p): Block => ({ t: "row", left: paymentLabel(p.method), right: euros(p.amountCents) })),
      ...(change > 0 ? [{ t: "row", left: "Cambio", right: euros(change) } as Block] : []),
      ...footerBlocks(input.design),
      { t: "feed", lines: 2 },
    ],
  };
}

// ---------- Cuenta (antes de cobrar) ----------

export interface BillInput extends TicketHeader {
  tableLabel: string;
  at: Date;
  lines: { qty: number; name: string; totalCents: number }[];
  totalCents: number;
  paidCents: number;
}

export function bill(input: BillInput): PrintDocument {
  return {
    blocks: [
      ...headerBlocks(input),
      { t: "rule" },
      { t: "text", text: "CUENTA", align: "center", bold: true, large: true },
      { t: "text", text: "Documento no válido como factura", align: "center" },
      { t: "row", left: input.design.showTable ? input.tableLabel : "", right: dateTime(input.at) },
      { t: "rule" },
      ...input.lines.map((l): Block => ({ t: "row", left: `${l.qty} x ${l.name}`, right: euros(l.totalCents) })),
      { t: "rule" },
      { t: "row", left: "TOTAL", right: euros(input.totalCents), bold: true, large: true },
      ...(input.paidCents > 0
        ? [
            { t: "row", left: "Ya pagado", right: euros(input.paidCents) } as Block,
            { t: "row", left: "Pendiente", right: euros(input.totalCents - input.paidCents), bold: true } as Block,
          ]
        : []),
      { t: "feed", lines: 2 },
    ],
  };
}

/**
 * Ticket de ejemplo con el diseño actual, para que el restaurante vea en
 * papel cómo queda (se lanza desde el portal). No es una factura.
 */
export function sampleReceipt(header: TicketHeader, verifactu: boolean): PrintDocument {
  const doc = receipt({
    ...header,
    numSerie: "PRUEBA",
    issuedAt: new Date(),
    tableLabel: "Terraza · Mesa 4",
    waiterName: "Ana",
    lines: [
      { qty: 2, name: "Caña", totalCents: 440 },
      { qty: 1, name: "Patatas bravas", totalCents: 650 },
      { qty: 1, name: "Tarta de queso", totalCents: 450 },
    ],
    breakdown: [{ rate: 10, baseCents: 1400, quotaCents: 140 }],
    totalCents: 1540,
    payments: [{ method: "CASH", amountCents: 1540, tenderedCents: 2000 }],
    qrUrl: null,
  });
  return {
    blocks: [
      { t: "text", text: "*** TICKET DE PRUEBA ***", align: "center", bold: true },
      { t: "text", text: "Sin validez fiscal", align: "center" },
      { t: "feed" },
      // Hueco que ocupará el QR tributario en los tickets reales
      ...(verifactu
        ? ([
            { t: "text", text: "[ aquí irá el QR tributario ]", align: "center" },
            { t: "text", text: "VERI*FACTU", align: "center", bold: true },
            { t: "feed" },
          ] as Block[])
        : []),
      ...doc.blocks,
    ],
  };
}

export function testPage(printerName: string): PrintDocument {
  return {
    blocks: [
      { t: "text", text: "PRUEBA DE IMPRESIÓN", align: "center", bold: true, large: true },
      { t: "text", text: printerName, align: "center" },
      { t: "text", text: dateTime(new Date()), align: "center" },
      { t: "rule" },
      { t: "text", text: "Acentos: áéíóú ÁÉÍÓÚ ñÑ ¿? ¡! €" },
      { t: "row", left: "Columna izquierda", right: "derecha" },
      { t: "feed", lines: 2 },
    ],
  };
}
