import { useState } from "react";
import type { FloorTable, FloorZone } from "../types";
import { api } from "../lib/api";
import { confirmAndRun } from "../lib/notify";
import { useResource } from "../lib/useResource";
import { LoadState, PageHeader } from "../components/common";
import { ZoneForm } from "./ZoneForm";
import { TableForm } from "./TableForm";

type Editing =
  | { kind: "zone"; zone: FloorZone | null }
  | { kind: "table"; table: FloorTable | null; zoneId: string }
  | null;

export function FloorPage() {
  const floor = useResource(api.floor, ["config:updated"]);
  const [editing, setEditing] = useState<Editing>(null);
  const zones = floor.data;

  async function removeZone(z: FloorZone) {
    const ok = await confirmAndRun(`¿Borrar la zona «${z.name}»?`, () => api.deleteZone(z.id), "Zona borrada");
    if (ok) floor.reload();
  }

  async function removeTable(z: FloorZone, t: FloorTable) {
    const ok = await confirmAndRun(
      `¿Borrar la mesa ${t.number} de ${z.name}?`,
      () => api.deleteTable(t.id),
      "Mesa borrada",
    );
    if (ok) floor.reload();
  }

  return (
    <>
      <PageHeader title="Salón">
        <button className="btn primary" onClick={() => setEditing({ kind: "zone", zone: null })}>
          Nueva zona
        </button>
      </PageHeader>
      <p className="muted small intro">Zonas y mesas del restaurante. El estado en vivo de las mesas está en «En directo».</p>

      <LoadState error={floor.error} loading={!zones} />
      {zones?.length === 0 && <p className="muted panel">Aún no hay zonas. Crea la primera (por ejemplo «Interior»).</p>}

      {zones?.map((z) => (
        <section key={z.id} className="panel" data-testid={`zone-${z.name}`}>
          <div className="panel-header">
            <div>
              <h2>{z.name}</h2>
              <span className="muted small">
                {z.tables.length} {z.tables.length === 1 ? "mesa" : "mesas"} · Orden {z.sortOrder}
              </span>
            </div>
            <div className="row-actions">
              <button className="btn small" onClick={() => setEditing({ kind: "table", table: null, zoneId: z.id })}>
                Añadir mesa
              </button>
              <button className="btn small ghost" onClick={() => setEditing({ kind: "zone", zone: z })}>
                Editar
              </button>
              <button className="btn small danger" onClick={() => removeZone(z)}>
                Borrar
              </button>
            </div>
          </div>

          {z.tables.length === 0 ? (
            <p className="muted small">Sin mesas.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table fixed">
                <colgroup>
                  <col />
                  <col className="col-num" />
                  <col className="col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Mesa</th>
                    <th className="num">Comensales</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {z.tables.map((t) => (
                    <tr key={t.id}>
                      <td>Mesa {t.number}</td>
                      <td className="num">{t.capacity}</td>
                      <td className="row-actions">
                        <button
                          className="btn small ghost"
                          onClick={() => setEditing({ kind: "table", table: t, zoneId: z.id })}
                        >
                          Editar
                        </button>
                        <button className="btn small danger" onClick={() => removeTable(z, t)}>
                          Borrar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      {editing?.kind === "zone" && <ZoneForm zone={editing.zone} onClose={() => setEditing(null)} onSaved={floor.reload} />}
      {editing?.kind === "table" && zones && (
        <TableForm
          table={editing.table}
          zoneId={editing.zoneId}
          zones={zones}
          onClose={() => setEditing(null)}
          onSaved={floor.reload}
        />
      )}
    </>
  );
}
