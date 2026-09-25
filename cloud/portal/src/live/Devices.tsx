import type { Device } from "../types";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { confirmAndRun } from "../lib/notify";

export function Devices({ devices, onChange }: { devices: Device[]; onChange: () => void }) {
  if (!devices.length) {
    return (
      <div className="empty">
        <p>Todavía no hay ningún servidor local vinculado.</p>
        <p className="muted small">
          Para vincularlo, abre la aplicación de escritorio del TPV en el restaurante y, en la pantalla de acceso, pulsa
          «Portal: sin vincular · Configurar». Introduce la dirección de este portal (
          <code>{window.location.origin}</code>) con este mismo usuario y contraseña. A partir de ese momento verás aquí las mesas y ventas en directo, y los cambios de carta, salón y
          personal se enviarán al restaurante.
        </p>
      </div>
    );
  }

  async function revoke(d: Device) {
    const ok = await confirmAndRun(
      `¿Revocar el acceso de «${d.name}»? Dejará de sincronizar hasta que se vuelva a vincular con el usuario y la contraseña.`,
      () => api.revokeDevice(d.id),
      "Dispositivo revocado",
    );
    if (ok) onChange();
  }

  return (
    <ul className="device-list">
      {devices.map((d) => (
        <li key={d.id}>
          <span className={`dot ${d.online ? "online" : "offline"}`} aria-hidden />
          <div className="device-info">
            <strong>{d.name}</strong>
            <span className="muted small">
              {d.online ? "En línea" : "Desconectado"}
              {!d.online && d.lastSeenAt && ` · última conexión ${formatDateTime(d.lastSeenAt)}`}
            </span>
          </div>
          <button className="btn danger small" onClick={() => revoke(d)}>
            Revocar
          </button>
        </li>
      ))}
    </ul>
  );
}
