import { api } from "../lib/api";
import { startOfDay } from "../lib/dates";
import { money } from "../lib/format";
import { useResource } from "../lib/useResource";
import { Kpi, LoadState, PageHeader } from "../components/common";
import { FloorMap } from "./FloorMap";
import { OpenOrders } from "./OpenOrders";
import { Devices } from "./Devices";

export function LivePage() {
  const overview = useResource(() => api.overview(startOfDay(new Date())), [
    "live:updated",
    "config:updated",
    "devices:updated",
  ]);
  const floor = useResource(api.floor, ["live:updated", "config:updated"]);
  const orders = useResource(api.openOrders, ["live:updated"]);
  const o = overview.data;
  const tableCount = o ? o.tables.free + o.tables.occupied + o.tables.billRequested : 0;
  const zoneOfTable = new Map(floor.data?.flatMap((z) => z.tables.map((t) => [t.id, z.name] as const)));

  return (
    <>
      <PageHeader title="En directo">
        <span className="badge readonly">Solo lectura</span>
      </PageHeader>

      <LoadState error={overview.error} loading={!o} />
      {o && (
        <section className="kpi-grid" aria-label="Resumen de hoy">
          <Kpi label="Ventas de hoy" value={money(o.today.revenue)} />
          <Kpi label="Tickets" value={o.today.count} />
          <Kpi label="Ticket medio" value={money(o.today.averageTicket)} />
          <Kpi label="Comandas abiertas" value={o.openOrders.count} hint={money(o.openOrders.total)} />
          <Kpi
            label="Mesas ocupadas"
            value={`${o.tables.occupied + o.tables.billRequested} de ${tableCount}`}
            hint={`${o.tables.free} libres · ${o.tables.billRequested} piden la cuenta`}
          />
        </section>
      )}

      <section className="panel">
        <h2>Salón</h2>
        <LoadState error={floor.error} loading={!floor.data} />
        {floor.data && <FloorMap zones={floor.data} />}
      </section>

      <div className="two-col">
        <section className="panel">
          <h2>Comandas abiertas</h2>
          <LoadState error={orders.error} loading={!orders.data} />
          {orders.data && <OpenOrders orders={orders.data} zoneOfTable={zoneOfTable} />}
        </section>
        <section className="panel">
          <h2>Servidores vinculados</h2>
          {o && <Devices devices={o.devices} onChange={overview.reload} />}
        </section>
      </div>
    </>
  );
}
