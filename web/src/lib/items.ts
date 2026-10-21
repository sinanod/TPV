import type { OrderLine } from "../types";

// Al cobrar por artículos, las líneas iguales (mismo producto, precio y nota)
// se muestran juntas: «3 × Caña» aunque se pidieran en rondas distintas. Lo
// elegido se reparte después entre esas líneas.

export interface ItemGroup {
  key: string;
  name: string;
  note: string | null;
  unitCents: number;
  /** Unidades sin pagar */
  available: number;
  lines: { id: number; available: number }[];
}

export function groupLines(lines: OrderLine[]): ItemGroup[] {
  const groups = new Map<string, ItemGroup>();
  for (const l of lines) {
    const available = l.qty - (l.paidQty ?? 0);
    if (available <= 0) continue;
    const unitCents = Math.round(l.unitPrice * 100);
    const key = `${l.productId}|${unitCents}|${l.note ?? ""}`;
    const g = groups.get(key) ?? { key, name: l.product.name, note: l.note, unitCents, available: 0, lines: [] };
    g.available += available;
    g.lines.push({ id: l.id, available });
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** Selección por grupo → artículos por línea, como los espera el servidor. */
export function toItems(groups: ItemGroup[], selected: Record<string, number>) {
  const items: { lineId: number; qty: number }[] = [];
  for (const g of groups) {
    let left = Math.min(selected[g.key] ?? 0, g.available);
    for (const l of g.lines) {
      if (left <= 0) break;
      const qty = Math.min(left, l.available);
      items.push({ lineId: l.id, qty });
      left -= qty;
    }
  }
  return items;
}

export const selectionCents = (groups: ItemGroup[], selected: Record<string, number>) =>
  groups.reduce((s, g) => s + g.unitCents * Math.min(selected[g.key] ?? 0, g.available), 0);
