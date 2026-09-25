import { Fragment, useState } from "react";
import type { Order } from "../types";
import { formatDateTime, formatTime, money, paymentLabel } from "../lib/format";
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
                  <td>{t.tableLabel}</td>
                  <td>{t.waiterName ?? "—"}</td>
                  <td>{paymentLabel(t.paymentMethod)}</td>
                  <td className="num">{money(t.total)}</td>
                </tr>
                {open && (
                  <tr className="ticket-detail">
                    <td colSpan={5}>
                      <OrderLines lines={t.lines} />
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
