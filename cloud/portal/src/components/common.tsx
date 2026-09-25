import { ReactNode } from "react";
import type { OrderLine } from "../types";
import { money } from "../lib/format";

export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function LoadState({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) return <p className="error panel">No se han podido cargar los datos: {error}</p>;
  if (loading) return <p className="muted">Cargando…</p>;
  return null;
}

export function OrderLines({ lines }: { lines: OrderLine[] }) {
  return (
    <ul className="order-lines">
      {lines.map((l) => (
        <li key={l.id}>
          <span className="qty">{l.qty}×</span>
          <span className="line-name">
            {l.productName}
            {l.note && <em className="muted small"> — {l.note}</em>}
          </span>
          <span className="line-total">{money(l.qty * l.unitPrice)}</span>
        </li>
      ))}
    </ul>
  );
}
