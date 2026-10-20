import { useState } from "react";
import type { Category, Printer } from "../types";
import { api } from "../lib/api";
import { toast } from "../lib/notify";
import { FormModal } from "../components/FormModal";

type Props = { family: Category | null; printers: Printer[]; onClose: () => void; onSaved: () => void };

export function FamilyForm({ family, printers, onClose, onSaved }: Props) {
  const [name, setName] = useState(family?.name ?? "");
  const [printerId, setPrinterId] = useState(family ? (family.printerId ?? "") : (printers[0]?.id ?? ""));
  const [sortOrder, setSortOrder] = useState(String(family?.sortOrder ?? 0));

  async function save() {
    const data = { name, printerId: printerId || null, sortOrder: Number(sortOrder) };
    if (family) await api.updateCategory(family.id, data);
    else await api.createCategory(data);
    toast(family ? "Familia guardada" : "Familia creada");
    onSaved();
  }

  return (
    <FormModal title={family ? "Editar familia" : "Nueva familia"} onSubmit={save} onClose={onClose}>
      <label>
        Nombre
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoFocus />
      </label>
      <label>
        Impresora de comandas
        <select value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
          <option value="">Sin impresora — no se imprime</option>
          {printers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="hint">Al enviar una comanda, los productos de esta familia salen por esta impresora.</span>
      </label>
      {printers.length === 0 && (
        <p className="muted small">
          Aún no hay impresoras. Puedes darlas de alta en <a href="#printers">Impresoras</a>.
        </p>
      )}
      <label>
        Orden
        <input
          type="number"
          min={0}
          max={10000}
          step={1}
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          required
        />
      </label>
    </FormModal>
  );
}
