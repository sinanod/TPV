import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import { notify } from "../lib/notify";
import type { FailedPrintJob } from "../types";

// Un plato que no se imprime en cocina no sale: los fallos se quedan a la
// vista hasta que se reintenten o se descarten.
export function PrintAlerts() {
  const [jobs, setJobs] = useState<FailedPrintJob[]>([]);
  const [open, setOpen] = useState(false);

  const load = () => api.failedPrintJobs().then(setJobs).catch(() => {});

  useEffect(() => {
    load();
    const socket = getSocket();
    const onFailed = (e: { jobId: number; printerName: string; title: string; error: string }) => {
      notify("error", `${e.title}: no se imprimió en ${e.printerName} (${e.error})`, { key: `print:${e.jobId}` });
      load();
    };
    socket.on("print:failed", onFailed);
    return () => {
      socket.off("print:failed", onFailed);
    };
  }, []);

  async function retry(id: number) {
    const r = await api.retryPrintJob(id).catch((e) => ({ ok: false, error: e.message }) as { ok: boolean; error: string });
    notify(r.ok ? "success" : "error", r.ok ? "Impreso" : `Sigue sin imprimir: ${r.error}`);
    load();
  }

  async function dismiss(id: number) {
    await api.dismissPrintJob(id).catch(() => {});
    load();
  }

  if (!jobs.length) return null;
  return (
    <>
      <button className="print-alert-badge" onClick={() => setOpen(true)}>
        ⚠ {jobs.length} sin imprimir
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Impresiones fallidas</h2>
              <button className="link" onClick={() => setOpen(false)}>
                Cerrar
              </button>
            </div>
            <ul className="ticket-list">
              {jobs.map((j) => (
                <li key={j.id}>
                  <div className="ticket-row">
                    <strong>{j.title}</strong>
                    <span>{j.printerName}</span>
                  </div>
                  <p className="error">{j.error}</p>
                  <div className="ticket-actions">
                    <button className="link" onClick={() => retry(j.id)}>
                      Reintentar
                    </button>
                    <button className="link" onClick={() => dismiss(j.id)}>
                      Descartar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
