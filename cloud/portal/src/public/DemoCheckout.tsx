import { useEffect, useState } from "react";
import { euros, PaymentView, publicApi } from "./api";

export function DemoCheckout({ paymentId }: { paymentId: string }) {
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Pago de demostración";
    publicApi.payment(paymentId).then(setPayment, (e) => setError((e as Error).message));
  }, [paymentId]);

  const back = payment ? `/m/${encodeURIComponent(payment.tableToken)}?pago=${encodeURIComponent(payment.id)}` : null;

  async function finish(action: "confirm" | "cancel") {
    if (!payment || !back) return;
    setBusy(true);
    setError(null);
    try {
      await (action === "confirm" ? publicApi.demoConfirm(payment.id) : publicApi.demoCancel(payment.id));
      window.location.replace(back);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="c-page">
      <div className="c-demo-banner" role="note">
        <strong>MODO DEMOSTRACIÓN</strong>
        <span>No se realiza ningún cargo</span>
      </div>
      {!payment ? (
        <div className="c-card c-center">
          {error ? <p className="c-error">{error}</p> : <p className="c-muted">Cargando…</p>}
        </div>
      ) : (
        <section className="c-card c-center c-checkout">
          <p className="c-muted">{payment.restaurant}</p>
          <p>{payment.table}</p>
          <p className="c-big" data-testid="demo-amount">
            {euros(payment.amountCents)}
          </p>
          <p className="c-muted small">
            Esta es una pasarela de pruebas: no se pide ninguna tarjeta y no se mueve dinero.
          </p>
          {payment.status !== "CREATED" ? (
            <>
              <p>Este pago ya se ha {payment.status === "SUCCEEDED" ? "completado" : "cancelado"}.</p>
              <a className="c-btn" href={back!}>
                Volver a la cuenta
              </a>
            </>
          ) : (
            <div className="c-actions">
              <button className="c-btn primary" disabled={busy} onClick={() => finish("confirm")}>
                Simular pago correcto
              </button>
              <button className="c-btn" disabled={busy} onClick={() => finish("cancel")}>
                Cancelar
              </button>
            </div>
          )}
          {error && (
            <p className="c-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
