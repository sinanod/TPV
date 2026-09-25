import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { CloudStatus } from "../types";

function formatTime(iso: string | null) {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "medium" });
}

export function CloudPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ cloudUrl: "", username: "", password: "", deviceName: "" });
  const [unlinkPassword, setUnlinkPassword] = useState("");

  useEffect(() => {
    api.cloudStatus().then(setStatus).catch((e) => setError(e.message));
    const timer = setInterval(() => api.cloudStatus().then(setStatus).catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, []);

  async function run(action: () => Promise<CloudStatus>) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
      setForm((f) => ({ ...f, password: "" }));
      setUnlinkPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Conexión con el portal</h2>
          <button className="link" onClick={onClose}>
            Cerrar
          </button>
        </div>

        {!status && !error && <p>Cargando…</p>}

        {status && !status.linked && (
          <form
            className="cloud-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api.cloudLink({ ...form, deviceName: form.deviceName || undefined }));
            }}
          >
            <p className="hint">
              Vincula este TPV con la cuenta del restaurante en el portal. A partir de ese momento la carta, las
              mesas y el personal se gestionan desde el portal, y las ventas se envían allí automáticamente.
            </p>
            <label>
              Dirección del portal
              <input
                value={form.cloudUrl}
                onChange={(e) => setForm({ ...form, cloudUrl: e.target.value })}
                placeholder="https://mi-tpv.azurewebsites.net"
                required
              />
            </label>
            <label>
              Usuario del restaurante
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                autoComplete="username"
                required
              />
            </label>
            <label>
              Contraseña
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              Nombre de este equipo (opcional)
              <input
                value={form.deviceName}
                onChange={(e) => setForm({ ...form, deviceName: e.target.value })}
                placeholder="PC barra"
              />
            </label>
            <p className="warning">
              La carta, las mesas y el personal actuales de este TPV se sustituirán por los del portal.
            </p>
            <button type="submit" disabled={busy}>
              {busy ? "Vinculando…" : "Vincular"}
            </button>
          </form>
        )}

        {status?.linked && (
          <div className="cloud-status">
            <dl>
              <dt>Restaurante</dt>
              <dd>{status.tenantName}</dd>
              <dt>Portal</dt>
              <dd>{status.cloudUrl}</dd>
              <dt>Este equipo</dt>
              <dd>{status.deviceName}</dd>
              <dt>Estado</dt>
              <dd className={status.connected ? "ok" : "error"}>{status.connected ? "Conectado" : "Sin conexión"}</dd>
              <dt>Última sincronización</dt>
              <dd>{formatTime(status.lastSyncAt)}</dd>
              <dt>Configuración recibida</dt>
              <dd>
                v{status.configVersion} · {formatTime(status.lastConfigAt)}
              </dd>
              <dt>Pendiente de enviar</dt>
              <dd>{status.pendingEvents} cambios</dd>
            </dl>
            {status.lastError && <p className="error">{status.lastError}</p>}
            <button disabled={busy} onClick={() => void run(api.cloudSyncNow)}>
              Sincronizar ahora
            </button>

            <form
              className="cloud-form unlink"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => api.cloudUnlink(unlinkPassword));
              }}
            >
              <label>
                Para desvincular, contraseña del restaurante
                <input
                  type="password"
                  value={unlinkPassword}
                  onChange={(e) => setUnlinkPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              {status.pendingEvents > 0 && (
                <p className="warning">
                  Hay {status.pendingEvents} cambios sin enviar: si desvinculas sin conexión se perderán en el portal.
                </p>
              )}
              <button type="submit" className="danger" disabled={busy}>
                Desvincular
              </button>
            </form>
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
