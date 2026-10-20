import { useState } from "react";
import type { Printer } from "../types";
import { api } from "../lib/api";
import { PRINTER_TYPE } from "../lib/format";
import { confirmAndRun } from "../lib/notify";
import { useResource } from "../lib/useResource";
import { LoadState, PageHeader } from "../components/common";
import { PrinterForm } from "./PrinterForm";

export function PrintersPage() {
  const printers = useResource(api.printers, ["config:updated"]);
  const catalog = useResource(api.catalog, ["config:updated"]);
  const settings = useResource(api.settings, ["config:updated"]);
  const [editing, setEditing] = useState<Printer | "new" | null>(null);
  const list = printers.data?.printers;
  const receiptPrinterId = settings.data?.business.receiptPrinterId ?? null;
  const familiesOf = (id: string) => (catalog.data ?? []).filter((c) => c.printerId === id).map((c) => c.name);
  const unassigned = (catalog.data ?? []).filter((c) => !c.printerId).map((c) => c.name);

  async function remove(p: Printer) {
    const families = familiesOf(p.id);
    const warning = families.length
      ? ` Las familias ${families.join(", ")} se quedarán sin impresora y sus productos no se imprimirán.`
      : "";
    const ok = await confirmAndRun(
      `¿Borrar la impresora «${p.name}»?${warning}`,
      () => api.deletePrinter(p.id),
      "Impresora borrada",
    );
    if (ok) {
      printers.reload();
      catalog.reload();
      settings.reload();
    }
  }

  return (
    <>
      <PageHeader title="Impresoras">
        <button className="btn primary" onClick={() => setEditing("new")}>
          Nueva impresora
        </button>
      </PageHeader>
      <p className="muted small intro">
        Impresoras de cocina, barra y tickets del restaurante. Cada familia de la <a href="#catalog">carta</a> elige por
        cuál salen sus comandas. La impresora de los tickets para el cliente se elige en <a href="#settings">Ajustes</a>
        .
      </p>

      <LoadState error={printers.error} loading={!list} />
      {list && (
        <section className="panel">
          {list.length === 0 ? (
            <p className="muted">No hay impresoras. Da de alta la primera.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Conexión</th>
                    <th>Papel</th>
                    <th>Familias</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const families = familiesOf(p.id);
                    return (
                      <tr key={p.id} data-testid={`printer-${p.name}`}>
                        <td>
                          <strong>{p.name}</strong>
                          {p.id === receiptPrinterId && (
                            <>
                              {" "}
                              <span className="badge receipt">Tickets de cliente</span>
                            </>
                          )}
                        </td>
                        <td>
                          <span className="muted small">{PRINTER_TYPE[p.type]}</span>
                          <br />
                          <code>{p.type === "NETWORK" ? `${p.address}:${p.port}` : p.address}</code>
                        </td>
                        <td>{p.width} mm</td>
                        <td className="wrap">
                          {families.length ? families.join(", ") : <span className="muted">—</span>}
                        </td>
                        <td className="row-actions">
                          <button className="btn small ghost" onClick={() => setEditing(p)}>
                            Editar
                          </button>
                          <button className="btn small danger" onClick={() => remove(p)}>
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
          <div className="printer-summary small">
            <p>
              <strong>Tickets de cliente:</strong>{" "}
              {receiptPrinterId ? (
                (list.find((p) => p.id === receiptPrinterId)?.name ?? "—")
              ) : (
                <span className="warn-text">ninguna — los tickets no se imprimen</span>
              )}{" "}
              · <a href="#settings">Cambiar en Ajustes</a>
            </p>
            {unassigned.length > 0 && (
              <p>
                <strong>Familias sin impresora</strong> (no se imprimen): {unassigned.join(", ")}
              </p>
            )}
          </div>
        </section>
      )}

      {editing && printers.data && (
        <PrinterForm
          printer={editing === "new" ? null : editing}
          systemPrinters={printers.data.systemPrinters}
          onClose={() => setEditing(null)}
          onSaved={printers.reload}
        />
      )}
    </>
  );
}
