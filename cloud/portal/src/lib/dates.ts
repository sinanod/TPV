export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** "YYYY-MM-DD" en hora local (el valor de un <input type="date">). */
export function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateInput(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export type Preset = "today" | "yesterday" | "last7" | "month";

export const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Hoy" },
  { id: "yesterday", label: "Ayer" },
  { id: "last7", label: "Últimos 7 días" },
  { id: "month", label: "Este mes" },
];

/** Días inclusivos [from, to] en formato de <input type="date">. */
export function presetRange(preset: Preset, now = new Date()): { from: string; to: string } {
  const today = startOfDay(now);
  switch (preset) {
    case "today":
      return { from: toDateInput(today), to: toDateInput(today) };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: toDateInput(y), to: toDateInput(y) };
    }
    case "last7":
      return { from: toDateInput(addDays(today, -6)), to: toDateInput(today) };
    case "month":
      return { from: toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)), to: toDateInput(today) };
  }
}
