import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Category, Order, Table } from "../types";

export function OrderPanel({
  table,
  categories,
  onClose,
}: {
  table: Table;
  categories: Category[];
  onClose: () => void;
}) {
  const [order, setOrder] = useState<Order | null>(null);
  const [activeCategory, setActiveCategory] = useState(categories[0]?.id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadOrCreateOrder() {
    try {
      const existing = await api.orderForTable(table.id).catch(() => null);
      if (existing) {
        setOrder(existing);
        return;
      }
      const { order: created } = await api.openTable(table.id);
      const full = await api.orderForTable(table.id);
      setOrder(full ?? created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir la mesa");
    }
  }

  useEffect(() => {
    setOrder(null);
    setError(null);
    loadOrCreateOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.id]);

  async function addProduct(productId: number) {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.addLines(order.id, [{ productId, qty: 1 }]);
      setOrder(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al añadir producto");
    } finally {
      setBusy(false);
    }
  }

  async function removeLine(lineId: number) {
    if (!order) return;
    setBusy(true);
    try {
      const updated = await api.deleteLine(order.id, lineId);
      setOrder(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo quitar la línea");
    } finally {
      setBusy(false);
    }
  }

  async function sendToKitchen() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.sendOrder(order.id);
      setOrder(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No hay líneas pendientes");
    } finally {
      setBusy(false);
    }
  }

  async function closeOrder(paymentMethod: "CASH" | "CARD") {
    if (!order) return;
    setBusy(true);
    try {
      await api.closeOrder(order.id, paymentMethod);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cobrar");
      setBusy(false);
    }
  }

  const hasPending = order?.lines.some((l) => l.status === "PENDING") ?? false;
  const category = categories.find((c) => c.id === activeCategory);

  return (
    <div className="order-panel">
      <div className="order-panel-header">
        <h2>Mesa {table.number}</h2>
        <button className="link" onClick={onClose}>
          Cerrar
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="category-tabs">
        {categories.map((c) => (
          <button
            key={c.id}
            className={c.id === activeCategory ? "active" : ""}
            onClick={() => setActiveCategory(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="product-grid">
        {category?.products.map((p) => (
          <button key={p.id} disabled={busy || !order} onClick={() => addProduct(p.id)}>
            {p.name}
            <span>{p.price.toFixed(2)} €</span>
          </button>
        ))}
      </div>

      <div className="order-lines">
        <h3>Comanda</h3>
        {!order && <p>Cargando…</p>}
        {order?.lines.length === 0 && <p>Todavía sin productos</p>}
        <ul>
          {order?.lines.map((line) => (
            <li key={line.id} className={`line-${line.status.toLowerCase()}`}>
              <span>
                {line.qty}× {line.product.name}
                {line.note ? ` (${line.note})` : ""}
              </span>
              <span>{(line.qty * line.unitPrice).toFixed(2)} €</span>
              {line.status === "PENDING" && (
                <button className="link" onClick={() => removeLine(line.id)}>
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="order-total">Total: {(order?.total ?? 0).toFixed(2)} €</div>
      </div>

      <div className="order-actions">
        <button disabled={!hasPending || busy} onClick={sendToKitchen}>
          Enviar a cocina/barra
        </button>
        <button disabled={!order || busy} onClick={() => closeOrder("CASH")}>
          Cobrar (efectivo)
        </button>
        <button disabled={!order || busy} onClick={() => closeOrder("CARD")}>
          Cobrar (tarjeta)
        </button>
      </div>
    </div>
  );
}
