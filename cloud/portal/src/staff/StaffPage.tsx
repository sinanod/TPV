import { useState } from "react";
import type { Staff } from "../types";
import { api } from "../lib/api";
import { ROLE } from "../lib/format";
import { confirmAndRun } from "../lib/notify";
import { useResource } from "../lib/useResource";
import { LoadState, PageHeader } from "../components/common";
import { StaffForm } from "./StaffForm";

export function StaffPage() {
  const staff = useResource(api.staff, ["config:updated"]);
  const [editing, setEditing] = useState<Staff | "new" | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function remove(s: Staff) {
    const ok = await confirmAndRun(`¿Borrar a ${s.name}? Ya no podrá entrar en el TPV.`, () => api.deleteStaff(s.id), "Empleado borrado");
    if (ok) staff.reload();
  }

  return (
    <>
      <PageHeader title="Personal">
        <button className="btn primary" onClick={() => setEditing("new")}>
          Nuevo empleado
        </button>
      </PageHeader>
      <p className="muted small intro">
        Cada empleado entra en el TPV del restaurante y en la app de camareros con su PIN. Los encargados pueden además
        administrar el TPV local. Los cambios se envían automáticamente al restaurante.
      </p>

      <LoadState error={staff.error} loading={!staff.data} />
      {staff.data && (
        <section className="panel">
          {staff.data.length === 0 ? (
            <p className="muted">No hay personal dado de alta.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Rol</th>
                    <th>PIN</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {staff.data.map((s) => {
                    const shown = revealed.has(s.id);
                    return (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>
                          <span className={`badge role-${s.role.toLowerCase()}`}>{ROLE[s.role]}</span>
                        </td>
                        <td className="nowrap">
                          <code className="pin">{shown ? s.pin : "•".repeat(s.pin.length)}</code>
                          <button
                            className="btn small ghost"
                            onClick={() => toggleReveal(s.id)}
                            aria-label={`${shown ? "Ocultar" : "Mostrar"} PIN de ${s.name}`}
                          >
                            {shown ? "Ocultar" : "Ver"}
                          </button>
                        </td>
                        <td className="row-actions">
                          <button className="btn small ghost" onClick={() => setEditing(s)}>
                            Editar
                          </button>
                          <button className="btn small danger" onClick={() => remove(s)}>
                            Borrar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {editing && (
        <StaffForm staff={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={staff.reload} />
      )}
    </>
  );
}
