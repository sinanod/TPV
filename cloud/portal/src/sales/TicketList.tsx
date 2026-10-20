import { Fragment, useState } from "react";
import type { Order, Payment } from "../types";
import { formatDateTime, formatTime, money, moneyCents, paymentLabel, paymentsSummary } from "../lib/format";
import { OrderLines } from "../components/common";

export function TicketList({ tickets, showDate }: { tickets: Order[]; showDate: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!tickets.length) return <p className="muted">No hay tickets cobrados en este periodo.</p>;

  return (
    <div className="table-scroll">
      <table className="data-table tickets">
        <thead>
          <tr>
            <th>{showDate ? "Fecha" : "Hora"}</th>
            <th>Factura</th>
            <th>Mesa</th>
            <th>Camarero</th>
            <th>Pago</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => {
            const open = expanded === t.id;
            const closed = t.closedAt ?? t.openedAt;
            return (
              <Fragment key={t.id}>
                <tr
                  className="clickable"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : t.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setExpanded(open ? null : t.id)}
                >
                  <td className="nowrap">
                    <span className="chevron" aria-hidden>
                      {open ? "▾" : "▸"}
                    </span>
                    {showDate ? formatDateTime(closed) : formatTime(closed)}
                  </td>
                  <td>{t.invoiceNumber ? <code>{t.invoiceNumber}</code> : <span className="muted">—</span>}</td>
                  <td>{t.tableLabel}</td>
                  <td>{t.waiterName ?? "—"}</td>
                  <td>{paymentsSummary(t.payments, t.paymentMethod)}</td>
                  <td className="num">{money(t.total)}</td>
                </tr>
                {open && (
                  <tr className="ticket-detail">
                    <td colSpan={6}>
                      <OrderLines lines={t.lines} />
                      <PaymentList payments={t.payments ?? []} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PaymentList({ payments }: { payments: Payment[] }) {
  const paid = payments.filter((p) => p.amountCents > 0 || p.refundCents > 0);
  if (!paid.length) return null;
  return (
    <ul className="payment-list small">
      {paid.map((p, i) => (
        <li key={i}>
          <span>{paymentLabel(p.method)}</span>
          <span className="muted">
            {p.tenderedCents !== null &&
              p.tenderedCents > p.amountCents &&
              `entregado ${moneyCents(p.tenderedCents)} · cambio ${moneyCents(p.tenderedCents - p.amountCents)}`}
            {p.refundCents > 0 && <span className="warn-text"> devuelto {moneyCents(p.refundCents)}</span>}
          </span>
          <strong>{moneyCents(p.amountCents)}</strong>
        </li>
      ))}
    </ul>
  );
}
