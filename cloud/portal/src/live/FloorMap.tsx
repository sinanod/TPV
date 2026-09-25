import type { FloorZone } from "../types";
import { money, TABLE_STATUS } from "../lib/format";

export function FloorMap({ zones }: { zones: FloorZone[] }) {
  if (!zones.length) return <p className="muted">No hay zonas ni mesas. Créalas en la sección Salón.</p>;

  return (
    <>
      <div className="legend small">
        <span className="dot status-free" /> Libre
        <span className="dot status-occupied" /> Ocupada
        <span className="dot status-bill_requested" /> Pide la cuenta
      </div>
      {zones.map((zone) => (
        <div key={zone.id} className="zone">
          <h3>{zone.name}</h3>
          {zone.tables.length === 0 && <p className="muted small">Sin mesas.</p>}
          <div className="table-grid">
            {zone.tables.map((t) => (
              <div
                key={t.id}
                className={`table-tile status-${t.status.toLowerCase()}`}
                data-testid={`table-${zone.name}-${t.number}`}
              >
                <span className="table-number">Mesa {t.number}</span>
                <span className="table-status">{TABLE_STATUS[t.status]}</span>
                {t.openOrder ? (
                  <>
                    <span className="table-total">{money(t.openOrder.total)}</span>
                    <span className="table-waiter">{t.openOrder.waiterName ?? "—"}</span>
                  </>
                ) : (
                  <span className="table-capacity">{t.capacity} pax</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
