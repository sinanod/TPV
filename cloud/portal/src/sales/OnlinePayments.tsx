import type { OnlinePayment } from "../types";
import { formatDateTime, moneyCents } from "../lib/format";

export const needsRefund = (p: OnlinePayment) => p.refundCents > 0;

function status(p: OnlinePayment) {
  if (!p.applyResult) return <span className="badge warn">Pendiente de registrar en el TPV</span>;
  if (p.applyResult === "APPLIED") return <span className="badge ok">Registrado en la cuenta</span>;
  const reason =
    p.applyResult === "ORDER_NOT_FOUND"
      ? "La cuenta ya no existía en el TPV"
      : p.refundCents < p.amountCents
        ? "Pagó más de lo que quedaba pendiente"
        : "La cuenta ya estaba pagada";
  return (
    <>
      <span className="badge danger">Devolver {moneyCents(p.refundCents)}</span>
      <span className="block small muted">{reason}</span>
    </>
  );
}

export function OnlinePayments({ payments }: { payments: OnlinePayment[] }) {
  const refunds = payments.filter(needsRefund);
  const refundTotal = refunds.reduce((s, p) => s + p.refundCents, 0);

  return (
    <>
      {refunds.length > 0 && (
        <div className="refund-alert" role="alert">
          <strong>
            Hay que devolver {moneyCents(refundTotal)} a{" "}
            {refunds.length === 1 ? "un cliente" : `${refunds.length} clientes`}
          </strong>
          <p className="small">
            Pagaron desde el móvil cuando la cuenta ya estaba cobrada (o había desaparecido). El TPV no ha sumado ese
            dinero: devuélveselo desde el panel de tu pasarela de pago.
          </p>
        </div>
      )}
      <section className="panel">
        <h2>Pagos de clientes desde el móvil</h2>
        <p className="muted small">Los últimos 100 pagos completados con el QR de las mesas.</p>
        {payments.length === 0 ? (
          <p className="muted">Todavía no hay pagos desde el móvil.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Mesa</th>
                  <th className="num">Importe</th>
                  <th>Email</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className={needsRefund(p) ? "row-refund" : undefined} data-testid={`online-${p.id}`}>
                    <td>{p.paidAt ? formatDateTime(p.paidAt) : "—"}</td>
                    <td>{p.tableLabel}</td>
                    <td className="num">{moneyCents(p.amountCents)}</td>
                    <td>{p.email ?? <span className="muted">—</span>}</td>
                    <td className="wrap">{status(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
