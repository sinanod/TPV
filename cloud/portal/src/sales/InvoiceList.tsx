import { Fragment, useState } from "react";
import type { AeatStatus, Invoice } from "../types";
import { api } from "../lib/api";
import { addDays, fromDateInput } from "../lib/dates";
import { AEAT_ENVIRONMENT, AEAT_STATUS, EMAIL_STATUS, formatDateTime, moneyCents } from "../lib/format";
import { toast } from "../lib/notify";
import { useResource } from "../lib/useResource";
import { LoadState } from "../components/common";
import { FormModal } from "../components/FormModal";
import { PaymentList } from "./TicketList";

type Range = { from: string; to: string };

export function InvoiceList({ range }: { range: Range }) {
  const [status, setStatus] = useState<AeatStatus | "">("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [emailFor, setEmailFor] = useState<Invoice | null>(null);
  const invoices = useResource(
    () => {
      if (!range.from || !range.to || range.from > range.to) return Promise.reject(new Error("Revisa las fechas"));
      return api.invoices(fromDateInput(range.from), addDays(fromDateInput(range.to), 1), status);
    },
    ["live:updated", "verifactu:updated"],
    [range.from, range.to, status],
  );
  const list = invoices.data;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Facturas (tickets emitidos)</h2>
        <label className="inline-select">
          Estado VERI*FACTU
          <select value={status} onChange={(e) => setStatus(e.target.value as AeatStatus | "")}>
            <option value="">Todos</option>
            {Object.entries(AEAT_STATUS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <LoadState error={invoices.error} loading={!list} />
      {list?.length === 0 && <p className="muted">No hay facturas en este periodo.</p>}
      {list && list.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Número</th>
                <th>Mesa</th>
                <th className="num">Total</th>
                <th>VERI*FACTU</th>
                <th>Email</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((i) => {
                const open = expanded === i.id;
                return (
                  <Fragment key={i.id}>
                    <tr
                      className={`clickable${i.aeatStatus === "REJECTED" ? " row-error" : ""}`}
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : i.id)}
                      onKeyDown={(e) =>
                        e.target === e.currentTarget && e.key === "Enter" && setExpanded(open ? null : i.id)
                      }
                      data-testid={`invoice-${i.numSerie}`}
                    >
                      <td className="nowrap">
                        <span className="chevron" aria-hidden>
                          {open ? "▾" : "▸"}
                        </span>
                        {formatDateTime(i.issuedAt)}
                      </td>
                      <td>
                        <code>{i.numSerie}</code>
                      </td>
                      <td>{i.tableLabel}</td>
                      <td className="num">{moneyCents(i.totalCents)}</td>
                      <td className="wrap aeat-cell">
                        <span className={`badge aeat-${i.aeatStatus.toLowerCase()}`}>{AEAT_STATUS[i.aeatStatus]}</span>
                        {i.environment === "TEST" && <span className="badge"> Pruebas</span>}
                        {i.aeatError && (
                          <span className="error small block">
                            {i.aeatErrorCode && `${i.aeatErrorCode}: `}
                            {i.aeatError}
                          </span>
                        )}
                      </td>
                      <td className="wrap">
                        {i.emails.length ? (
                          i.emails.map((m) => (
                            <span key={m.to} className="block small" title={m.lastError ?? undefined}>
                              {m.to} ·{" "}
                              <span className={`email-${m.status.toLowerCase()}`}>{EMAIL_STATUS[m.status]}</span>
                            </span>
                          ))
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="row-actions">
                        <button
                          className="btn small ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEmailFor(i);
                          }}
                        >
                          Enviar por email
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="ticket-detail">
                        <td colSpan={7}>
                          <InvoiceDetail invoice={i} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {emailFor && <EmailForm invoice={emailFor} onClose={() => setEmailFor(null)} onSent={invoices.reload} />}
    </section>
  );
}

function InvoiceDetail({ invoice: i }: { invoice: Invoice }) {
  return (
    <div className="invoice-detail">
      <ul className="order-lines">
        {i.lines.map((l, n) => (
          <li key={n}>
            <span className="qty">{l.qty}×</span>
            <span className="line-name">
              {l.name} <span className="muted small">IVA {l.taxRate} %</span>
            </span>
            <span className="line-total">{moneyCents(l.totalCents)}</span>
          </li>
        ))}
      </ul>
      <p className="small muted">
        IVA incluido: {moneyCents(i.taxCents)}
        {i.waiterName && ` · Camarero: ${i.waiterName}`}
      </p>
      <PaymentList payments={i.payments} />
      {i.aeatStatus !== "NOT_APPLICABLE" && (
        <dl className="aeat-detail small">
          <dt>Entorno</dt>
          <dd>{i.environment ? AEAT_ENVIRONMENT[i.environment] : "—"}</dd>
          <dt>Enviado a la AEAT</dt>
          <dd>{i.aeatSentAt ? formatDateTime(i.aeatSentAt) : "Aún no"}</dd>
          <dt>CSV (justificante)</dt>
          <dd>{i.aeatCsv ? <code>{i.aeatCsv}</code> : "—"}</dd>
          {i.aeatError && (
            <>
              <dt>Error de la AEAT</dt>
              <dd className="error">
                {i.aeatErrorCode && `${i.aeatErrorCode}: `}
                {i.aeatError}
              </dd>
            </>
          )}
          {i.qrUrl && (
            <>
              <dt>QR del ticket</dt>
              <dd>
                <a href={i.qrUrl} target="_blank" rel="noreferrer">
                  Comprobar en la sede de la AEAT
                </a>
              </dd>
            </>
          )}
        </dl>
      )}
      {i.emails.some((m) => m.lastError) && (
        <p className="small error">
          {i.emails
            .filter((m) => m.lastError)
            .map((m) => `${m.to}: ${m.lastError}`)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

function EmailForm({ invoice, onClose, onSent }: { invoice: Invoice; onClose: () => void; onSent: () => void }) {
  const [email, setEmail] = useState(invoice.emails[0]?.to ?? "");

  async function send() {
    await api.emailInvoice(invoice.id, email.trim());
    toast(`Ticket ${invoice.numSerie} en cola para ${email.trim()}`);
    onSent();
  }

  return (
    <FormModal title={`Enviar el ticket ${invoice.numSerie}`} onSubmit={send} onClose={onClose}>
      <label>
        Email del cliente
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          autoCapitalize="none"
          inputMode="email"
        />
      </label>
      <p className="muted small">Si ya se había enviado a este email, se vuelve a enviar.</p>
    </FormModal>
  );
}
