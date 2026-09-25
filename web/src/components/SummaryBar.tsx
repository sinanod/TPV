import type { DashboardSummary } from "../types";

export function SummaryBar({ summary }: { summary: DashboardSummary | null }) {
  if (!summary) return null;
  return (
    <div className="summary-bar">
      <div>
        <strong>{summary.revenueToday.toFixed(2)} €</strong>
        <span>Ventas hoy</span>
      </div>
      <div>
        <strong>{summary.ordersToday}</strong>
        <span>Comandas cobradas</span>
      </div>
      <div>
        <strong>{summary.averageTicket.toFixed(2)} €</strong>
        <span>Ticket medio</span>
      </div>
      <div>
        <strong>
          {summary.tables.occupied} / {summary.tables.free + summary.tables.occupied}
        </strong>
        <span>Mesas ocupadas</span>
      </div>
    </div>
  );
}
