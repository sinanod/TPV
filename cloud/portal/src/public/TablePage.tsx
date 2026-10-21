import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { euros, PaymentView, publicApi, PublicError, TableView } from "./api";

const REFRESH_MS = 5000;

type Mode = "all" | "items" | "custom" | "split";
type BillLine = NonNullable<TableView["bill"]>["lines"][number];

/** Mismas líneas juntas («3 × Caña» aunque se pidieran en rondas distintas). */
function groupLines(lines: BillLine[]) {
  const groups = new Map<string, { key: string; name: string; unitCents: number; available: number; lines: { lineId: number; available: number }[] }>();
  for (const l of lines) {
    if (l.lineId === null || l.availableQty <= 0) continue;
    const key = `${l.name}|${l.unitCents}`;
    const g = groups.get(key) ?? { key, name: l.name, unitCents: l.unitCents, available: 0, lines: [] };
    g.available += l.availableQty;
    g.lines.push({ lineId: l.lineId, available: l.availableQty });
    groups.set(key, g);
  }
  return [...groups.values()];
}

function parseEuros(value: string) {
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function paymentDone(p: PaymentView) {
  if (p.status === "CANCELLED" || p.status === "FAILED") return true;
  if (p.status !== "SUCCEEDED" || !p.registeredByRestaurant) return false;
  return !p.email || p.receipt?.status === "SENT" || p.receipt?.status === "FAILED";
}

export function TablePage({ token, paymentId: initialPaymentId }: { token: string; paymentId: string | null }) {
  const [view, setView] = useState<TableView | null>(null);
  const [error, setError] = useState<PublicError | null>(null);
  const [paymentId, setPaymentId] = useState(initialPaymentId);
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const paymentFinished = useRef(false);

  const load = useCallback(async () => {
    try {
      setView(await publicApi.table(token));
      setError(null);
    } catch (e) {
      setError(e as PublicError);
    }
    if (paymentId && !paymentFinished.current) {
      try {
        const p = await publicApi.payment(paymentId);
        setPayment(p);
        paymentFinished.current = paymentDone(p);
      } catch (e) {
        if ((e as PublicError).status === 404) {
          setPaymentError((e as Error).message);
          paymentFinished.current = true;
        }
      }
    }
  }, [token, paymentId]);

  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (view) document.title = `${view.restaurant} · ${view.table}`;
  }, [view?.restaurant, view?.table]);

  function closePayment() {
    window.history.replaceState(null, "", window.location.pathname);
    setPaymentId(null);
    setPayment(null);
    setPaymentError(null);
    paymentFinished.current = false;
  }

  if (!view) {
    if (error?.status === 404) {
      return (
        <main className="c-page">
          <div className="c-card c-center">
            <h1>Código QR no válido</h1>
            <p>Este código no corresponde a ninguna mesa. Puede que se haya renovado: pide ayuda al camarero.</p>
          </div>
        </main>
      );
    }
    return (
      <main className="c-page">
        <div className="c-card c-center">
          {error ? (
            <>
              <p>{error.message}</p>
              <button className="c-btn" onClick={load}>
                Reintentar
              </button>
            </>
          ) : (
            <p className="c-muted">Cargando tu cuenta…</p>
          )}
        </div>
      </main>
    );
  }

  const bill = view.bill;
  return (
    <main className="c-page">
      <header className="c-header">
        {view.logoUrl && <img className="c-logo" src={view.logoUrl} alt="" />}
        <h1>{view.restaurant}</h1>
        <p>{view.table}</p>
      </header>

      {error && <p className="c-offline">Sin conexión. Reintentando…</p>}

      {paymentId && <PaymentStatus payment={payment} error={paymentError} onClose={closePayment} />}

      {!bill ? (
        <section className="c-card c-center">
          <h2>No hay ninguna cuenta abierta</h2>
          <p className="c-muted">Cuando pidas, aquí podrás ver tu cuenta. ¡Que aproveche!</p>
        </section>
      ) : (
        <>
          <section className="c-card" aria-label="Tu cuenta">
            <h2>Tu cuenta</h2>
            <ul className="c-lines">
              {bill.lines.map((l, i) => (
                <li key={i}>
                  <span className="c-qty">{l.qty}×</span>
                  <span className="c-name">
                    {l.name}
                    {bill.pendingCents > 0 && l.lineId !== null && l.availableQty < l.qty && (
                      <small className="c-paid-tag">
                        {l.availableQty === 0 ? " · pagado" : ` · ${l.qty - l.availableQty} pagado${l.qty - l.availableQty > 1 ? "s" : ""}`}
                      </small>
                    )}
                  </span>
                  <span className="c-amount">{euros(l.totalCents)}</span>
                </li>
              ))}
            </ul>
            <dl className="c-totals">
              <div>
                <dt>Total</dt>
                <dd>{euros(bill.totalCents)}</dd>
              </div>
              {bill.paidCents > 0 && (
                <div>
                  <dt>Pagado</dt>
                  <dd>−{euros(bill.paidCents)}</dd>
                </div>
              )}
              <div className="c-pending">
                <dt>Pendiente</dt>
                <dd data-testid="pending">{euros(bill.pendingCents)}</dd>
              </div>
            </dl>
          </section>

          {bill.pendingCents <= 0 ? (
            <section className="c-card c-center">
              <h2>Cuenta pagada</h2>
              <p className="c-muted">¡Gracias por tu visita!</p>
            </section>
          ) : view.onlinePayments.enabled ? (
            <PayForm token={token} pendingCents={bill.pendingCents} lines={bill.lines} demo={view.onlinePayments.demo} />
          ) : (
            <section className="c-card c-center">
              <h2>Pide la cuenta a tu camarero</h2>
              <p className="c-muted">En este restaurante el pago se hace en la mesa o en la barra.</p>
            </section>
          )}
        </>
      )}
      <p className="c-foot">La cuenta se actualiza sola.</p>
    </main>
  );
}

function PayForm({
  token,
  pendingCents,
  lines,
  demo,
}: {
  token: string;
  pendingCents: number;
  lines: BillLine[];
  demo: boolean;
}) {
  const [mode, setMode] = useState<Mode>("all");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const groups = groupLines(lines);
  const itemsCents = groups.reduce((s, g) => s + g.unitCents * Math.min(selected[g.key] ?? 0, g.available), 0);
  const pick = (key: string, delta: number, max: number) =>
    setSelected((s) => ({ ...s, [key]: Math.max(0, Math.min(max, (s[key] ?? 0) + delta)) }));
  const [custom, setCustom] = useState("");
  const [people, setPeople] = useState(2);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amount =
    mode === "all"
      ? pendingCents
      : mode === "items"
        ? // Si alguien pagó antes una cantidad suelta, como mucho lo que queda
          Math.min(itemsCents, pendingCents)
        : mode === "split"
          ? Math.ceil(pendingCents / people)
          : parseEuros(custom);
  const invalid =
    mode === "custom" && custom.trim() !== ""
      ? !(amount > 0)
        ? "Escribe un importe válido"
        : amount > pendingCents
          ? `Como máximo ${euros(pendingCents)}`
          : null
      : null;
  const canPay = amount > 0 && amount <= pendingCents && !busy;

  async function pay(e: FormEvent) {
    e.preventDefault();
    if (!canPay) return;
    setBusy(true);
    setError(null);
    try {
      const items = groups.flatMap((g) => {
        let left = Math.min(selected[g.key] ?? 0, g.available);
        return g.lines.flatMap((l) => {
          const qty = Math.min(left, l.available);
          left -= qty;
          return qty > 0 ? [{ lineId: l.lineId, qty }] : [];
        });
      });
      const { redirectUrl } = await publicApi.pay(token, mode === "items" ? { items } : { amountCents: amount }, email.trim());
      window.location.href = redirectUrl;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="c-card" onSubmit={pay} aria-label="Pagar">
      <h2>Pagar desde el móvil</h2>
      <div className="c-options" role="radiogroup" aria-label="Cuánto quieres pagar">
        <label className={`c-option${mode === "all" ? " active" : ""}`}>
          <input type="radio" name="mode" checked={mode === "all"} onChange={() => setMode("all")} />
          <span>Todo lo pendiente</span>
          <strong>{euros(pendingCents)}</strong>
        </label>
        {groups.length > 0 && (
          <label className={`c-option${mode === "items" ? " active" : ""}`}>
            <input type="radio" name="mode" checked={mode === "items"} onChange={() => setMode("items")} />
            <span>Pagar solo lo mío</span>
          </label>
        )}
        {mode === "items" && (
          <div className="c-sub">
            <p className="c-muted">Elige lo que has tomado:</p>
            <ul className="c-items">
              {groups.map((g) => {
                const n = Math.min(selected[g.key] ?? 0, g.available);
                return (
                  <li key={g.key} className={n ? "picked" : undefined}>
                    <button type="button" className="c-item-name" onClick={() => pick(g.key, 1, g.available)}>
                      <span>{g.name}</span>
                      <small>
                        {euros(g.unitCents)}
                        {g.available > 1 ? ` · quedan ${g.available}` : ""}
                      </small>
                    </button>
                    <div className="c-stepper small">
                      <button type="button" aria-label={`Quitar ${g.name}`} disabled={!n} onClick={() => pick(g.key, -1, g.available)}>
                        −
                      </button>
                      <span aria-live="polite">{n}</span>
                      <button type="button" aria-label={`Añadir ${g.name}`} disabled={n >= g.available} onClick={() => pick(g.key, 1, g.available)}>
                        +
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p>
              Lo tuyo: <strong>{euros(amount)}</strong>
            </p>
          </div>
        )}
        <label className={`c-option${mode === "custom" ? " active" : ""}`}>
          <input type="radio" name="mode" checked={mode === "custom"} onChange={() => setMode("custom")} />
          <span>Otra cantidad</span>
        </label>
        {mode === "custom" && (
          <div className="c-sub">
            <label className="c-field">
              Importe en euros
              <div className="c-euro-input">
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  aria-invalid={!!invalid}
                  autoFocus
                />
                <span>€</span>
              </div>
            </label>
            {invalid && <p className="c-error">{invalid}</p>}
          </div>
        )}
        <label className={`c-option${mode === "split" ? " active" : ""}`}>
          <input type="radio" name="mode" checked={mode === "split"} onChange={() => setMode("split")} />
          <span>Dividir entre varios</span>
        </label>
        {mode === "split" && (
          <div className="c-sub c-split">
            <div className="c-stepper">
              <button type="button" aria-label="Menos personas" onClick={() => setPeople((n) => Math.max(2, n - 1))}>
                −
              </button>
              <span aria-live="polite">
                {people} <small>personas</small>
              </span>
              <button type="button" aria-label="Más personas" onClick={() => setPeople((n) => Math.min(30, n + 1))}>
                +
              </button>
            </div>
            <p>
              Cada uno: <strong>{euros(amount)}</strong>
            </p>
          </div>
        )}
      </div>

      <label className="c-field">
        Email (opcional), para recibirte el ticket
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
        />
      </label>

      {demo && <p className="c-demo-note">Modo demostración: no se cobra nada.</p>}
      {error && (
        <p className="c-error" role="alert">
          {error}
        </p>
      )}
      <button className="c-btn primary" disabled={!canPay}>
        {busy ? "Abriendo el pago…" : amount > 0 && amount <= pendingCents ? `Pagar ${euros(amount)}` : "Pagar"}
      </button>
    </form>
  );
}

function PaymentStatus({
  payment: p,
  error,
  onClose,
}: {
  payment: PaymentView | null;
  error: string | null;
  onClose: () => void;
}) {
  let body;
  if (error) body = <p>{error}</p>;
  else if (!p) body = <p className="c-muted">Comprobando el pago…</p>;
  else if (p.status === "CANCELLED" || p.status === "FAILED")
    body = (
      <>
        <h2>{p.status === "CANCELLED" ? "Pago cancelado" : "El pago no se ha completado"}</h2>
        <p>No se ha cobrado nada. Puedes volver a intentarlo.</p>
      </>
    );
  else if (p.status === "CREATED")
    body = (
      <>
        <h2>Esperando la confirmación del pago…</h2>
        <p className="c-muted">Si has cerrado la página de pago sin terminar, puedes volver a intentarlo.</p>
      </>
    );
  else
    body = (
      <>
        <h2>Pago de {euros(p.amountCents)} realizado</h2>
        {p.registeredByRestaurant ? (
          <p>El restaurante ya lo ha registrado en tu cuenta. ¡Gracias!</p>
        ) : (
          <p className="c-wait">Avisando al restaurante…</p>
        )}
        {p.refundCents > 0 && (
          <p className="c-refund">
            {p.refundCents < p.amountCents
              ? "Has pagado más de lo que quedaba pendiente"
              : "La cuenta ya estaba pagada"}
            : el restaurante te devolverá <strong>{euros(p.refundCents)}</strong>.
          </p>
        )}
        {p.email && <p className="c-muted">{receiptText(p)}</p>}
        {p.demo && <p className="c-demo-note">Pago de demostración: no se ha cobrado dinero real.</p>}
      </>
    );

  const tone = !p ? "" : p.status === "SUCCEEDED" ? " ok" : p.status === "CREATED" ? "" : " bad";
  return (
    <section className={`c-card c-status${tone}`} aria-live="polite" data-testid="payment-status">
      <button className="c-close" onClick={onClose} aria-label="Cerrar">
        ×
      </button>
      {body}
    </section>
  );
}

function receiptText(p: PaymentView) {
  switch (p.receipt?.status) {
    case "SENT":
      return `Te hemos enviado el ticket a ${p.email}.`;
    case "FAILED":
      return `No hemos podido enviar el ticket a ${p.email}. Pídeselo al camarero.`;
    case "PENDING":
      return `El ticket va de camino a ${p.email}.`;
    default:
      return `Te enviaremos el ticket a ${p.email} cuando se cierre la cuenta.`;
  }
}
