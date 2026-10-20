import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import { euros, notify } from "../lib/notify";
import type { Category, Order, PaymentResponse, PrintResult, Table } from "../types";
import { PaymentDialog } from "./PaymentDialog";

function reportPrints(prints: (PrintResult | null)[]) {
  for (const p of prints) {
    if (p && !p.ok) {
      notify("error", `No se imprimió en ${p.printerName}: ${p.error}`, {
        key: `print:${p.jobId}`,
        action: { label: "Reintentar", run: () => void api.retryPrintJob(p.jobId).then((r) => reportPrints([r])) },
      });
    }
  }
}

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
  const [paying, setPaying] = useState(false);

  async function loadOrCreateOrder() {
    try {
      const existing = await api.orderForTable(table.id).catch(() => null);
      if (existing) {
        setOrder(existing);
        return;
      }
      await api.openTable(table.id);
      setOrder(await api.orderForTable(table.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir la mesa");
    }
  }

  useEffect(() => {
    setOrder(null);
    setError(null);
    setPaying(false);
    loadOrCreateOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.id]);

  // Otros dispositivos (Android, pagos desde el móvil del cliente) cambian la
  // misma comanda: se recarga al recibir cambios.
  useEffect(() => {
    if (!order) return;
    const socket = getSocket();
    const reload = () => {
      api
        .orderForTable(table.id)
        .then(setOrder)
        .catch(() => onClose());
    };
    socket.on("order:updated", reload);
    socket.on("order:closed", reload);
    return () => {
      socket.off("order:updated", reload);
      socket.off("order:closed", reload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, table.id]);

  async function run(action: () => Promise<void>, fallbackError: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackError);
    } finally {
      setBusy(false);
    }
  }

  const addProduct = (productId: number) =>
    run(async () => setOrder(await api.addLines(order!.id, [{ productId, qty: 1 }])), "Error al añadir producto");

  const removeLine = (lineId: number) =>
    run(async () => setOrder(await api.deleteLine(order!.id, lineId)), "No se pudo quitar la línea");

  const sendToKitchen = () =>
    run(async () => {
      const { prints, ...updated } = await api.sendOrder(order!.id);
      setOrder(updated);
      reportPrints(prints);
      const ok = prints.filter((p) => p.ok).map((p) => p.printerName);
      if (ok.length) notify("success", `Comanda enviada a ${ok.join(" y ")}`);
    }, "No hay líneas pendientes");

  const printBill = () =>
    run(async () => {
      const result = await api.printBill(order!.id);
      reportPrints([result]);
      if (result.ok) notify("success", "Cuenta impresa");
    }, "No se pudo imprimir la cuenta");

  function handlePaid(result: PaymentResponse) {
    setOrder(result.order);
    if (result.change > 0) notify("info", `Cambio: ${euros(result.change)}`, { duration: 15000 });
    reportPrints([result.receiptPrint]);
    if (result.invoice) {
      notify("success", `Mesa ${table.number} cobrada · Ticket ${result.invoice.numSerie}`);
      onClose();
    }
  }

  const hasPending = order?.lines.some((l) => l.status === "PENDING") ?? false;
  const category = categories.find((c) => c.id === activeCategory);
  const payments = order?.payments.filter((p) => p.amount > 0) ?? [];

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
          <button key={c.id} className={c.id === activeCategory ? "active" : ""} onClick={() => setActiveCategory(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="product-grid">
        {category?.products.map((p) => (
          <button key={p.id} disabled={busy || !order} onClick={() => addProduct(p.id)}>
            {p.name}
            <span>{euros(p.price)}</span>
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
              <span>{euros(line.qty * line.unitPrice)}</span>
              {line.status === "PENDING" && (
                <button className="link" onClick={() => removeLine(line.id)}>
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="order-total">Total: {euros(order?.total ?? 0)}</div>
        {payments.length > 0 && (
          <div className="order-paid">
            <span>Pagado {euros(order!.paid)}</span>
            <span className="strong">Pendiente {euros(order!.pending)}</span>
          </div>
        )}
      </div>

      <div className="order-actions">
        <button disabled={!hasPending || busy} onClick={sendToKitchen}>
          Enviar a cocina/barra
        </button>
        <button className="secondary" disabled={!order || !order.lines.length || busy} onClick={printBill}>
          Imprimir cuenta
        </button>
        <button disabled={!order || busy || (order.lines.length > 0 && order.pending <= 0)} onClick={() => setPaying(true)}>
          {order && order.lines.length === 0 ? "Liberar mesa" : "Cobrar"}
        </button>
      </div>

      {paying && order && order.lines.length > 0 && (
        <PaymentDialog order={order} onPaid={handlePaid} onClose={() => setPaying(false)} />
      )}
      {paying && order && order.lines.length === 0 && (
        <ReleaseTable
          onConfirm={() =>
            run(async () => {
              await api.closeOrder(order.id, "CASH");
              onClose();
            }, "No se pudo liberar la mesa")
          }
          onCancel={() => setPaying(false)}
        />
      )}
    </div>
  );
}

function ReleaseTable({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Liberar mesa</h2>
        <p className="hint">La mesa no tiene consumiciones: se cerrará sin emitir ticket.</p>
        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button onClick={onConfirm}>Liberar</button>
        </div>
      </div>
    </div>
  );
}
