import { useState } from "react";
import type { FloorTable, FloorZone } from "../types";
import { api } from "../lib/api";
import { toast } from "../lib/notify";
import { FormModal } from "../components/FormModal";

type Props = {
  table: FloorTable | null;
  zoneId: string;
  zones: FloorZone[];
  onClose: () => void;
  onSaved: () => void;
};

function nextNumber(zone: FloorZone | undefined) {
  return Math.max(0, ...(zone?.tables.map((t) => t.number) ?? [])) + 1;
}

export function TableForm({ table, zoneId, zones, onClose, onSaved }: Props) {
  const [zone, setZone] = useState(table?.zoneId ?? zoneId);
  const [number, setNumber] = useState(String(table?.number ?? nextNumber(zones.find((z) => z.id === zoneId))));
  const [capacity, setCapacity] = useState(String(table?.capacity ?? 4));

  async function save() {
    const data = { zoneId: zone, number: Number(number), capacity: Number(capacity) };
    if (table) await api.updateTable(table.id, data);
    else await api.createTable(data);
    toast(table ? "Mesa guardada" : "Mesa creada");
    onSaved();
  }

  return (
    <FormModal title={table ? `Editar mesa ${table.number}` : "Nueva mesa"} onSubmit={save} onClose={onClose}>
      <label>
        Número
        <input
          type="number"
          min={1}
          max={10000}
          step={1}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          required
          autoFocus
        />
      </label>
      <label>
        Comensales
        <input
          type="number"
          min={1}
          max={100}
          step={1}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          required
        />
      </label>
      <label>
        Zona
        <select value={zone} onChange={(e) => setZone(e.target.value)}>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </label>
    </FormModal>
  );
}
