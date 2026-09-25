import type { Order } from "../types";
import { paymentLabel } from "./format";

function cell(value: string): string {
  // Excel ejecuta como fórmula lo que empieza por = + - @ (inyección CSV).
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const decimal = (n: number) => n.toFixed(2).replace(".", ",");

export function ticketsToCsv(tickets: Order[]): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const header = ["Fecha", "Hora", "Mesa", "Camarero", "Forma de pago", "Total", "Productos"];
  const rows = tickets.map((t) => {
    const d = new Date(t.closedAt ?? t.openedAt);
    const lines = t.lines.map((l) => `${l.qty}x ${l.productName}`).join(", ");
    return [
      cell(`${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`),
      cell(`${pad(d.getHours())}:${pad(d.getMinutes())}`),
      cell(t.tableLabel),
      cell(t.waiterName ?? ""),
      cell(paymentLabel(t.paymentMethod)),
      decimal(t.total),
      cell(lines),
    ].join(";");
  });
  return [header.join(";"), ...rows].join("\r\n");
}

export function downloadCsv(filename: string, content: string) {
  // El BOM hace que Excel detecte UTF-8 y muestre bien las tildes.
  const blob = new Blob(["﻿", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
