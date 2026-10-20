import { FormEvent, useState } from "react";
import type { Business, Printer, Settings } from "../types";
import { api } from "../lib/api";
import { toast } from "../lib/notify";

type Props = { business: Business; printers: Printer[]; onSaved: (s: Settings) => void };

export function BusinessPanel({ business, printers, onSaved }: Props) {
  const [form, setForm] = useState(business);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (field: keyof Business) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveBusiness({ ...form, receiptPrinterId: form.receiptPrinterId || null });
      setForm(saved.business);
      onSaved(saved);
      toast("Datos fiscales guardados");
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <form className="panel settings-form" onSubmit={submit} aria-label="Datos fiscales">
      <h2>Datos fiscales</h2>
      <p className="muted small">Aparecen en la cabecera de cada ticket y en los registros que se envían a Hacienda.</p>
      <div className="form-grid">
        <label>
          Nombre comercial
          <input value={form.tradeName} onChange={set("tradeName")} maxLength={120} placeholder="Bar Pepe" />
        </label>
        <label>
          Razón social
          <input value={form.legalName} onChange={set("legalName")} maxLength={120} placeholder="Bar Pepe SL" />
        </label>
        <label>
          NIF
          <input
            value={form.nif}
            onChange={set("nif")}
            maxLength={20}
            placeholder="B12345678"
            autoCapitalize="characters"
          />
        </label>
        <label>
          Dirección
          <input value={form.address} onChange={set("address")} maxLength={200} placeholder="Calle Mayor 1, Madrid" />
        </label>
        <label className="span-2">
          Impresora de tickets de cliente
          <select value={form.receiptPrinterId ?? ""} onChange={set("receiptPrinterId")}>
            <option value="">Sin impresora — no se imprimen tickets</option>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="hint">
            Donde sale el ticket al cobrar. Las impresoras se gestionan en <a href="#printers">Impresoras</a>.
          </span>
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="btn primary" disabled={busy}>
          {busy ? "Guardando…" : "Guardar datos"}
        </button>
      </div>
    </form>
  );
}
