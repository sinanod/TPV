import type { AeatStatus, OrderStatus, Payment, PrinterType, Role, TableStatus, TaxRate } from "../types";

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const time = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });
const dateTime = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" });
const shortDate = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
const longDay = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export const money = (n: number) => eur.format(n);
export const moneyCents = (cents: number) => eur.format(cents / 100);
export const formatTime = (iso: string) => time.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => shortDate.format(new Date(iso));
export const formatDay = (d: Date) => longDay.format(d);

export const TABLE_STATUS: Record<TableStatus, string> = {
  FREE: "Libre",
  OCCUPIED: "Ocupada",
  BILL_REQUESTED: "Pide la cuenta",
};

export const ORDER_STATUS: Record<OrderStatus, string> = {
  OPEN: "Abierta",
  SENT: "Enviada",
  SERVED: "Servida",
  PAID: "Cobrada",
  CANCELLED: "Anulada",
};

export const TAX_RATES: TaxRate[] = [10, 21, 4, 5, 0];

export const PRINTER_TYPE: Record<PrinterType, string> = { NETWORK: "Red (IP)", SYSTEM: "USB / instalada en el PC" };

export const AEAT_STATUS: Record<AeatStatus, string> = {
  PENDING: "Pendiente",
  CORRECT: "Correcto",
  ACCEPTED_WITH_ERRORS: "Aceptado con errores",
  REJECTED: "Rechazado",
  NOT_APPLICABLE: "Sin VERI*FACTU",
};

export const AEAT_ENVIRONMENT = { TEST: "Pruebas", PRODUCTION: "Producción" } as const;

export const EMAIL_STATUS = { PENDING: "En cola", SENT: "Enviado", FAILED: "Error" } as const;

export const ROLE: Record<Role, string> = { ADMIN: "Encargado", WAITER: "Camarero", KITCHEN: "Cocina" };

const PAYMENT: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  ONLINE: "Pago móvil",
  MIXED: "Dividido",
  OTHER: "Otro",
};
export const paymentLabel = (method: string | null) => PAYMENT[method ?? "OTHER"] ?? method ?? "Otro";

export function paymentsSummary(payments: Payment[] | undefined, fallbackMethod: string | null): string {
  const paid = (payments ?? []).filter((p) => p.amountCents > 0);
  if (!paid.length) return paymentLabel(fallbackMethod);
  if (paid.length === 1) return paymentLabel(paid[0].method);
  return paid.map((p) => `${paymentLabel(p.method)} ${moneyCents(p.amountCents)}`).join(" + ");
}

export function parseDecimal(value: string): number {
  return Number(value.trim().replace(",", "."));
}
