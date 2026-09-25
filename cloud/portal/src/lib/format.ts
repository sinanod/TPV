import type { OrderStatus, PrinterTag, Role, TableStatus } from "../types";

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const time = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });
const dateTime = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" });
const longDay = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export const money = (n: number) => eur.format(n);
export const formatTime = (iso: string) => time.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
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

export const PRINTER_TAG: Record<PrinterTag, string> = { KITCHEN: "Cocina", BAR: "Barra", NONE: "Ninguno" };

export const ROLE: Record<Role, string> = { ADMIN: "Encargado", WAITER: "Camarero", KITCHEN: "Cocina" };

const PAYMENT: Record<string, string> = { CASH: "Efectivo", CARD: "Tarjeta", OTHER: "Otro" };
export const paymentLabel = (method: string | null) => PAYMENT[method ?? "OTHER"] ?? method ?? "Otro";

export function parseDecimal(value: string): number {
  return Number(value.trim().replace(",", "."));
}
