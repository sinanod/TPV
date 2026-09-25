import type { Order } from "../types";
import { formatTime, money, ORDER_STATUS } from "../lib/format";
import { OrderLines } from "../components/common";

type Props = { orders: Order[]; zoneOfTable: Map<string, string> };

export function OpenOrders({ orders, zoneOfTable }: Props) {
  if (!orders.length) return <p className="muted">No hay comandas abiertas.</p>;

  return (
    <div className="order-list">
      {orders.map((o) => (
        <OrderCard key={o.id} order={o} zone={o.tableId ? zoneOfTable.get(o.tableId) : undefined} />
      ))}
    </div>
  );
}

function OrderCard({ order, zone }: { order: Order; zone?: string }) {
  return (
    <article className="order-card">
      <header>
        <strong>
          {order.tableLabel}
          {zone && <span className="muted"> · {zone}</span>}
        </strong>
        <span className={`badge order-${order.status.toLowerCase()}`}>{ORDER_STATUS[order.status]}</span>
      </header>
      <p className="muted small">
        {order.waiterName ?? "Sin camarero"} · abierta a las {formatTime(order.openedAt)}
      </p>
      <OrderLines lines={order.lines} />
      <p className="order-total">{money(order.total)}</p>
    </article>
  );
}
