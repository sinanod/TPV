import { useState } from "react";
import type { Category, PrinterTag } from "../types";
import { api } from "../lib/api";
import { PRINTER_TAG } from "../lib/format";
import { toast } from "../lib/notify";
import { FormModal } from "../components/FormModal";

type Props = { category: Category | null; onClose: () => void; onSaved: () => void };

export function CategoryForm({ category, onClose, onSaved }: Props) {
  const [name, setName] = useState(category?.name ?? "");
  const [printerTag, setPrinterTag] = useState<PrinterTag>(category?.printerTag ?? "KITCHEN");
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 0));

  async function save() {
    const data = { name, printerTag, sortOrder: Number(sortOrder) };
    if (category) await api.updateCategory(category.id, data);
    else await api.createCategory(data);
    toast(category ? "Categoría guardada" : "Categoría creada");
    onSaved();
  }

  return (
    <FormModal title={category ? "Editar categoría" : "Nueva categoría"} onSubmit={save} onClose={onClose}>
      <label>
        Nombre
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoFocus />
      </label>
      <label>
        Impresora de comandas
        <select value={printerTag} onChange={(e) => setPrinterTag(e.target.value as PrinterTag)}>
          {Object.entries(PRINTER_TAG).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
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
