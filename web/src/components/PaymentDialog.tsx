import { useState } from "react";
import { api } from "../lib/api";
import { euros } from "../lib/notify";
import type { Order, PaymentResponse } from "../types";

const parseEuros = (s: string) => {
  const n = Number(s.replace(",", ".").trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const toInput = (n: number) => n.toFixed(2).replace(".", ",");

const METHOD_LABEL = { CASH: "Efectivo", CARD: "Tarjeta", ONLINE: "Pago móvil" } as const;

export function PaymentDialog({
  order,
  onPaid,
  onClose,
}: {
  order: Order;
  /** Tras cada cobro; si `invoice` no es null la cuenta está cerrada */
  onPaid: (result: PaymentResponse) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<"CASH" | "CARD">("CARD");
  const [amount, setAmount] = useState(toInput(order.pending));
  const [tendered, setTendered] = useState("");
  const [email, setEmail] = useState("");
  const [splitWays, setSplitWays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountValue = parseEuros(amount);
  const tenderedValue = tendered ? parseEuros(tendered) : null;
  const change = method === "CASH" && tenderedValue !== null && tenderedValue >= amountValue ? tenderedValue - amountValue : 0;
  const isFinal = Math.abs(amountValue - order.pending) < 0.005;

  function split(ways: string) {
    setSplitWays(ways);
    const n = Number(ways);
    if (Number.isInteger(n) && n > 1) setAmount(toInput(Math.ceil((order.pending / n) * 100) / 100));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!(amountValue > 0)) return setError("Indica un importe mayor que cero");
    if (amountValue > order.pending + 0.005) return setError(`Lo pendiente es ${euros(order.pending)}`);
    if (method === "CASH" && tenderedValue !== null && tenderedValue < amountValue) {
      return setError("El efectivo entregado no cubre el importe");
    }
    setBusy(true);
    try {
      const result = await api.addPayment(order.id, {
        method,
        amount: amountValue,
        ...(method === "CASH" && tenderedValue ? { tendered: tenderedValue } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      onPaid(result);
      if (!result.invoice) {
        // Al dividir, la siguiente parte se calcula con los que quedan por pagar
        const remainingWays = Number(splitWays) - 1;
        if (Number.isInteger(remainingWays) && remainingWays > 1) {
          setSplitWays(String(remainingWays));
          setAmount(toInput(Math.ceil((result.order.pending / remainingWays) * 100) / 100));
        } else {
          setSplitWays("");
          setAmount(toInput(result.order.pending));
        }
        setTendered("");
        setEmail("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cobrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal payment-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <h2>Cobrar</h2>
          <button type="button" className="link" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <dl className="payment-totals">
          <dt>Total</dt>
          <dd>{euros(order.total)}</dd>
          {order.paid > 0 && (
            <>
              <dt>Ya pagado</dt>
              <dd>{euros(order.paid)}</dd>
            </>
          )}
          <dt>Pendiente</dt>
          <dd className="strong">{euros(order.pending)}</dd>
        </dl>

        {order.payments.filter((p) => p.amount > 0).length > 0 && (
          <ul className="payment-list">
            {order.payments
              .filter((p) => p.amount > 0)
              .map((p) => (
                <li key={p.id}>
                  {METHOD_LABEL[p.method]} · {euros(p.amount)}
                  {p.email ? ` · ${p.email}` : ""}
                </li>
              ))}
          </ul>
        )}

        <div className="segmented" role="radiogroup" aria-label="Forma de pago">
          {(["CARD", "CASH"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={method === m} className={method === m ? "active" : ""} onClick={() => setMethod(m)}>
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>

        <label>
          Importe de este pago
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required />
        </label>
        <label>
          Dividir a partes iguales entre
          <input value={splitWays} onChange={(e) => split(e.target.value)} inputMode="numeric" placeholder="nº de personas" />
        </label>
        {method === "CASH" && (
          <label>
            Entregado (opcional, para el cambio)
            <input value={tendered} onChange={(e) => setTendered(e.target.value)} inputMode="decimal" placeholder={amount} />
          </label>
        )}
        {change > 0 && <p className="change">Cambio: {euros(change)}</p>}
        <label>
          Email del cliente para enviarle el ticket (opcional)
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" placeholder="cliente@ejemplo.com" />
        </label>

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Cobrando…" : isFinal ? `Cobrar ${euros(amountValue || 0)} y cerrar la mesa` : `Cobrar ${euros(amountValue || 0)}`}
        </button>
      </form>
    </div>
  );
}
