import { FormEvent, useState } from "react";
import type { AeatEnvironment, CertificateKind, Settings, Submission } from "../types";
import { api } from "../lib/api";
import { AEAT_ENVIRONMENT, formatDateTime } from "../lib/format";
import { toast } from "../lib/notify";
import { CertificateBox } from "./CertificateBox";

const SUBMISSION_STATUS: Record<string, string> = {
  Correcto: "Correcto",
  ParcialmenteCorrecto: "Parcialmente correcto",
  Incorrecto: "Incorrecto",
  ERROR: "Error de envío",
};

const dayLabel = (ymd: string) => ymd.split("-").reverse().join("/");

type Props = {
  verifactu: Settings["verifactu"];
  submissions: Submission[] | null;
  onSaved: (s: Settings) => void;
};

export function VerifactuPanel({ verifactu: v, submissions, onSaved }: Props) {
  const [enabled, setEnabled] = useState(v.enabled);
  const [environment, setEnvironment] = useState<AeatEnvironment>(v.environment);
  const [kind, setKind] = useState<CertificateKind>(v.certificateKind);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const goingLive = enabled && environment === "PRODUCTION" && !(v.enabled && v.environment === "PRODUCTION");
  const nextSend = v.nextSendAt && new Date(v.nextSendAt) > new Date() ? v.nextSendAt : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (
      goingLive &&
      !window.confirm(
        "En «Producción» cada ticket se envía de verdad a Hacienda. Tras el primer envío no se puede volver a «Pruebas» y, si lo desactivas, seguirá activo hasta el 31 de diciembre. ¿Continuar?",
      )
    )
      return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await api.saveVerifactu({ enabled, environment, certificateKind: kind });
      setEnabled(saved.verifactu.enabled);
      setEnvironment(saved.verifactu.environment);
      setMessage(saved.message ?? null);
      onSaved(saved);
      toast("VERI*FACTU guardado");
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <section className="panel" aria-labelledby="verifactu-title">
      <div className="panel-header">
        <h2 id="verifactu-title">VERI*FACTU</h2>
        <span className={`badge ${v.enabled ? (v.environment === "PRODUCTION" ? "ok" : "info") : ""}`}>
          {v.enabled ? `Activado · ${AEAT_ENVIRONMENT[v.environment]}` : "Desactivado"}
        </span>
      </div>
      <p className="small explain">
        Con VERI*FACTU, cada ticket que cobra el TPV se envía automáticamente a Hacienda (AEAT) y lleva impreso un
        código QR con el que el cliente puede comprobarlo. Mientras lo configuras, déjalo en el entorno de{" "}
        <strong>Pruebas</strong>: los envíos van al entorno de pruebas de la AEAT y no tienen efecto fiscal.
      </p>

      {message && (
        <p className="notice strong" role="status">
          {message}
        </p>
      )}
      {v.endDate && <p className="notice">VERI*FACTU dejará de usarse después del {dayLabel(v.endDate)}.</p>}
      {v.missing.length > 0 && (
        <div className="notice">
          <strong>Para poder activarlo falta:</strong>
          <ul>
            {v.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <dl className="stats">
        <div>
          <dt>Pendientes de enviar</dt>
          <dd>{v.pending}</dd>
        </div>
        <div>
          <dt>Rechazados</dt>
          <dd className={v.rejected ? "error" : undefined}>{v.rejected}</dd>
        </div>
        <div>
          <dt>Próximo envío</dt>
          <dd>{nextSend ? formatDateTime(nextSend) : v.pending ? "En cuanto sea posible" : "—"}</dd>
        </div>
      </dl>
      {v.rejected > 0 && (
        <p className="small">
          Revisa los tickets rechazados en <a href="#sales">Ventas → Facturas</a>.
        </p>
      )}
      {v.lastError && (
        <div className="error-box" role="alert">
          <strong>Último error al enviar a la AEAT</strong>
          <p>{v.lastError}</p>
        </div>
      )}

      <form className="verifactu-form" onSubmit={submit} aria-label="Configuración de VERI*FACTU">
        <label className="checkbox">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enviar los tickets a Hacienda (VERI*FACTU activado)
        </label>
        <fieldset className="segmented">
          <legend>Entorno</legend>
          <label className={environment === "TEST" ? "active" : undefined}>
            <input type="radio" name="env" checked={environment === "TEST"} onChange={() => setEnvironment("TEST")} />
            Pruebas
          </label>
          <label className={environment === "PRODUCTION" ? "active" : undefined}>
            <input
              type="radio"
              name="env"
              checked={environment === "PRODUCTION"}
              onChange={() => setEnvironment("PRODUCTION")}
            />
            Producción
          </label>
        </fieldset>
        <label>
          Tipo de certificado
          <select value={kind} onChange={(e) => setKind(e.target.value as CertificateKind)}>
            <option value="PERSONAL">De persona física o de representante</option>
            <option value="SELLO">Sello electrónico de la empresa</option>
          </select>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row-actions start">
          <button className="btn primary" disabled={busy}>
            {busy ? "Guardando…" : "Guardar VERI*FACTU"}
          </button>
        </div>
      </form>

      <CertificateBox verifactu={v} onSaved={onSaved} />

      <div className="sub-panel">
        <h3>Últimos envíos a la AEAT</h3>
        {!submissions ? (
          <p className="muted small">Cargando…</p>
        ) : submissions.length === 0 ? (
          <p className="muted small">Todavía no se ha enviado nada.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Entorno</th>
                  <th>Resultado</th>
                  <th className="num">Tickets</th>
                  <th>CSV (justificante)</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDateTime(s.sentAt)}</td>
                    <td>{AEAT_ENVIRONMENT[s.environment]}</td>
                    <td>
                      <span className={`badge aeat-sub-${s.status.toLowerCase()}`}>
                        {SUBMISSION_STATUS[s.status] ?? s.status}
                      </span>
                    </td>
                    <td className="num">{s.records}</td>
                    <td>{s.csv ? <code>{s.csv}</code> : <span className="muted">—</span>}</td>
                    <td className="wrap error-cell">{s.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
