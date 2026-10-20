import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { euros, notify } from "../lib/notify";
import type { InvoiceListItem } from "../types";

const time = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

export function TicketsPanel({ onClose }: { onClose: () => void }) {
  const [invoices, setInvoices] = useState<InvoiceListItem[] | null>(null);
  const [emailFor, setEmailFor] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.invoices().then(setInvoices).catch((e) => setError(e.message));
  }, []);

  async function reprint(id: number) {
    try {
      const r = await api.printInvoice(id);
      notify(r.ok ? "success" : "error", r.ok ? "Ticket reimpreso" : `No se imprimió: ${r.error}`);
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "No se pudo imprimir");
    }
  }

  async function sendEmail(e: React.FormEvent, id: number) {
    e.preventDefault();
    try {
      await api.emailInvoice(id, email.trim());
      notify("success", `Ticket enviado a ${email.trim()}`);
      setEmailFor(null);
      setEmail("");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "No se pudo enviar");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal tickets-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Tickets de hoy</h2>
          <button className="link" onClick={onClose}>
            Cerrar
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {invoices?.length === 0 && <p className="hint">Todavía no se ha cobrado ninguna mesa hoy.</p>}
        <ul className="ticket-list">
          {invoices?.map((i) => (
            <li key={i.id}>
              <div className="ticket-row">
                <span>
                  <strong>{i.numSerie}</strong> · {time(i.issuedAt)} · {i.tableLabel}
                </span>
                <span className="strong">{euros(i.total)}</span>
              </div>
              <div className="ticket-actions">
                <button className="link" onClick={() => reprint(i.id)}>
                  Reimprimir
                </button>
                <button className="link" onClick={() => setEmailFor(emailFor === i.id ? null : i.id)}>
                  Enviar por email
                </button>
              </div>
              {emailFor === i.id && (
                <form className="inline-form" onSubmit={(e) => sendEmail(e, i.id)}>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@ejemplo.com" autoFocus />
                  <button type="submit">Enviar</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
