import type { Order } from "../types";
import { fromDateInput, toDateInput } from "../lib/dates";
import { formatDay, money } from "../lib/format";

function groupByDay(tickets: Order[]) {
  const days = new Map<string, { count: number; revenue: number }>();
  for (const t of tickets) {
    const key = toDateInput(new Date(t.closedAt ?? t.openedAt));
    const day = days.get(key) ?? { count: 0, revenue: 0 };
    day.count += 1;
    day.revenue += t.total;
    days.set(key, day);
  }
  return [...days.entries()].sort(([a], [b]) => b.localeCompare(a));
}

export function DailyBreakdown({ tickets }: { tickets: Order[] }) {
  const days = groupByDay(tickets);
  if (!days.length) return <p className="muted">Sin ventas en este periodo.</p>;

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Día</th>
            <th className="num">Tickets</th>
            <th className="num">Ticket medio</th>
            <th className="num">Ventas</th>
          </tr>
        </thead>
        <tbody>
          {days.map(([key, d]) => (
            <tr key={key}>
              <td>{formatDay(fromDateInput(key))}</td>
              <td className="num">{d.count}</td>
              <td className="num">{money(d.revenue / d.count)}</td>
              <td className="num">{money(d.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
