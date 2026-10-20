// Documento de impresión independiente de la impresora: se traduce a ESC/POS
// (impresoras de red) o a HTML (impresoras del sistema vía la app de
// escritorio).

export type Block =
  | { t: "text"; text: string; align?: "left" | "center" | "right"; bold?: boolean; large?: boolean }
  | { t: "row"; left: string; right: string; bold?: boolean; large?: boolean }
  | { t: "rule" }
  | { t: "qr"; data: string }
  | { t: "feed"; lines?: number };

export interface PrintDocument {
  blocks: Block[];
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

export interface ReceiptInput {
  business: BusinessHeader | null;
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

function businessBlocks(b: BusinessHeader | null): Block[] {
  if (!b) return [];
  return [
    { t: "text", text: b.name, align: "center", bold: true, large: true },
    ...(b.legalName && b.legalName !== b.name ? [{ t: "text", text: b.legalName, align: "center" } as Block] : []),
    { t: "text", text: `NIF ${b.nif}`, align: "center" },
    ...(b.address ? [{ t: "text", text: b.address, align: "center" } as Block] : []),
  ];
}

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

  return {
    blocks: [
      ...qr,
      ...businessBlocks(input.business),
      { t: "rule" },
      { t: "text", text: "FACTURA SIMPLIFICADA", bold: true },
      { t: "row", left: `Nº ${input.numSerie}`, right: dateTime(input.issuedAt) },
      { t: "text", text: `${input.tableLabel} · ${input.waiterName}` },
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
      { t: "feed" },
      ...(input.business?.ticketFooter ? [{ t: "text", text: input.business.ticketFooter, align: "center" } as Block] : []),
      { t: "feed", lines: 2 },
    ],
  };
}

// ---------- Cuenta (antes de cobrar) ----------

export interface BillInput {
  business: BusinessHeader | null;
  tableLabel: string;
  at: Date;
  lines: { qty: number; name: string; totalCents: number }[];
  totalCents: number;
  paidCents: number;
}

export function bill(input: BillInput): PrintDocument {
  return {
    blocks: [
      ...businessBlocks(input.business),
      { t: "rule" },
      { t: "text", text: "CUENTA", align: "center", bold: true, large: true },
      { t: "text", text: "Documento no válido como factura", align: "center" },
      { t: "row", left: input.tableLabel, right: dateTime(input.at) },
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
