import { ChangeEvent, FormEvent, useRef, useState } from "react";
import type { Printer, Settings, TestPrintResult, TicketDesign } from "../types";
import { api } from "../lib/api";
import { toast } from "../lib/notify";
import { prepareLogo } from "../lib/thermal";
import { TicketPreview } from "./TicketPreview";

type Props = { settings: Settings; printers: Printer[]; restaurantName: string; onSaved: (s: Settings) => void };

const SIZES = [
  { value: 40, label: "Pequeño" },
  { value: 60, label: "Mediano" },
  { value: 85, label: "Grande" },
  { value: 100, label: "Todo el ancho" },
];

function designOf(s: Settings): TicketDesign {
  const { logo: _logo, ...design } = s.ticket;
  return design;
}

export function TicketPanel({ settings, printers, restaurantName, onSaved }: Props) {
  const [form, setForm] = useState<TicketDesign>(() => designOf(settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printResults, setPrintResults] = useState<TestPrintResult[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const logo = settings.ticket.logo;
  const receiptPrinter = printers.find((p) => p.id === settings.business.receiptPrinterId) ?? null;
  const paperMm = receiptPrinter?.width ?? 80;
  const saved = designOf(settings);
  const dirty = JSON.stringify(saved) !== JSON.stringify(form);

  const set = <K extends keyof TicketDesign>(key: K, value: TicketDesign[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function run(action: () => Promise<Settings>, done: string) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      onSaved(next);
      setForm(designOf(next));
      toast(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const prepared = await prepareLogo(file);
      // Guarda antes los ajustes pendientes para no perderlos al recargar
      if (dirty) await api.saveTicket(form);
      await run(() => api.uploadTicketLogo(prepared.base64), "Logo subido: llegará a los TPV en unos segundos");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeLogo() {
    if (!confirm("¿Quitar el logo del ticket?")) return;
    await run(api.deleteTicketLogo, "Logo eliminado");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(() => api.saveTicket(form), "Diseño del ticket guardado");
  }

  async function testPrint() {
    if (dirty && !(await run(() => api.saveTicket(form), "Diseño del ticket guardado"))) return;
    setPrinting(true);
    setPrintResults(null);
    try {
      const { results } = await api.testPrintTicket();
      setPrintResults(results);
    } catch (e) {
      setError((e as Error).message);
    }
    setPrinting(false);
  }

  return (
    <section className="panel" aria-labelledby="ticket-title">
      <div className="panel-header">
        <h2 id="ticket-title">Diseño del ticket</h2>
      </div>
      <p className="small explain">
        Personaliza el ticket que se entrega al cliente (el impreso y el que le llega por email). Lo que exige la ley
        —razón social, NIF, número, fecha, desglose de IVA y el QR de VERI*FACTU— sale siempre.
      </p>

      <div className="ticket-layout">
        <form onSubmit={submit} className="ticket-form" aria-label="Diseño del ticket">
          <div className="sub-panel">
            <h3>Logo</h3>
            {logo ? (
              <div className="logo-current">
                <img src={logo.dataUrl} alt="Logo actual" />
                <span className="hint">
                  {logo.width}×{logo.height} px
                </span>
              </div>
            ) : (
              <p className="hint">
                Sube el logo del restaurante (PNG, JPG, WebP o SVG). Mejor en negro sobre fondo blanco o transparente: la
                impresora térmica solo imprime en negro.
              </p>
            )}
            <div className="row-actions start">
              <button type="button" className="btn small" disabled={busy} onClick={() => fileRef.current?.click()}>
                {logo ? "Cambiar logo" : "Subir logo"}
              </button>
              {logo && (
                <button type="button" className="btn small danger" disabled={busy} onClick={removeLogo}>
                  Quitar
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={onFile}
                hidden
                aria-label="Archivo del logo"
              />
            </div>

            <fieldset className="segmented" disabled={!logo}>
              <legend>Tamaño</legend>
              {SIZES.map((s) => (
                <label key={s.value} className={form.logoSize === s.value ? "active" : undefined}>
                  <input
                    type="radio"
                    name="logo-size"
                    checked={form.logoSize === s.value}
                    onChange={() => set("logoSize", s.value)}
                  />
                  {s.label}
                </label>
              ))}
            </fieldset>
            <fieldset className="segmented" disabled={!logo}>
              <legend>Cómo pasarlo a blanco y negro</legend>
              <label className={form.logoStyle === "THRESHOLD" ? "active" : undefined}>
                <input
                  type="radio"
                  name="logo-style"
                  checked={form.logoStyle === "THRESHOLD"}
                  onChange={() => set("logoStyle", "THRESHOLD")}
                />
                Nítido (logos de colores planos)
              </label>
              <label className={form.logoStyle === "DITHER" ? "active" : undefined}>
                <input
                  type="radio"
                  name="logo-style"
                  checked={form.logoStyle === "DITHER"}
                  onChange={() => set("logoStyle", "DITHER")}
                />
                Tramado (fotos y degradados)
              </label>
            </fieldset>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={!form.showTradeName}
                disabled={!logo}
                onChange={(e) => set("showTradeName", !e.target.checked)}
              />
              El logo ya lleva el nombre: no repetir el nombre comercial
            </label>
          </div>

          <label>
            Texto bajo los datos del restaurante
            <textarea
              rows={3}
              maxLength={200}
              value={form.headerText}
              onChange={(e) => set("headerText", e.target.value)}
              placeholder={"Tel. 910 000 000\nwww.mirestaurante.es"}
            />
            <span className="hint">Hasta 4 líneas: teléfono, web, redes sociales…</span>
          </label>
          <label>
            Pie del ticket
            <textarea
              rows={3}
              maxLength={200}
              value={form.footer}
              onChange={(e) => set("footer", e.target.value)}
              placeholder="¡Gracias por su visita!"
            />
            <span className="hint">Hasta 4 líneas: agradecimiento, horario, wifi…</span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={form.showTable} onChange={(e) => set("showTable", e.target.checked)} />
            Mostrar la mesa
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={form.showWaiter} onChange={(e) => set("showWaiter", e.target.checked)} />
            Mostrar el nombre del camarero
          </label>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row-actions">
            <button type="button" className="btn" disabled={busy || printing || !receiptPrinter} onClick={testPrint}>
              {printing ? "Imprimiendo…" : "Imprimir ticket de prueba"}
            </button>
            <button className="btn primary" disabled={busy || !dirty}>
              {busy ? "Guardando…" : "Guardar diseño"}
            </button>
          </div>
          {!receiptPrinter && (
            <p className="hint">Para imprimir una prueba, elige antes la impresora de tickets en «Datos fiscales».</p>
          )}
          {printResults && (
            <ul className="print-results" aria-live="polite">
              {printResults.length === 0 && (
                <li className="warn-text">No hay ningún TPV conectado ahora mismo: enciende el TPV y vuelve a probar.</li>
              )}
              {printResults.map((r, i) => (
                <li key={i} className={r.ok ? "ok-text" : "error"}>
                  {r.deviceName}: {r.ok ? `impreso en ${r.printerName}` : r.error}
                </li>
              ))}
            </ul>
          )}
        </form>

        <TicketPreview
          design={form}
          logoUrl={logo?.dataUrl ?? null}
          business={settings.business}
          restaurantName={restaurantName}
          paperMm={paperMm}
          verifactu={settings.verifactu.enabled}
        />
      </div>
    </section>
  );
}
