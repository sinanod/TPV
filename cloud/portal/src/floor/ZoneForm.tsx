import { useState } from "react";
import type { FloorZone } from "../types";
import { api } from "../lib/api";
import { toast } from "../lib/notify";
import { FormModal } from "../components/FormModal";

type Props = { zone: FloorZone | null; onClose: () => void; onSaved: () => void };

export function ZoneForm({ zone, onClose, onSaved }: Props) {
  const [name, setName] = useState(zone?.name ?? "");
  const [sortOrder, setSortOrder] = useState(String(zone?.sortOrder ?? 0));

  async function save() {
    const data = { name, sortOrder: Number(sortOrder) };
    if (zone) await api.updateZone(zone.id, data);
    else await api.createZone(data);
    toast(zone ? "Zona guardada" : "Zona creada");
    onSaved();
  }

  return (
    <FormModal title={zone ? "Editar zona" : "Nueva zona"} onSubmit={save} onClose={onClose}>
      <label>
        Nombre
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoFocus />
      </label>
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
