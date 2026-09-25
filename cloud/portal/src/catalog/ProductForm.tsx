import { useState } from "react";
import type { Category, Product } from "../types";
import { api } from "../lib/api";
import { parseDecimal } from "../lib/format";
import { toast } from "../lib/notify";
import { FormModal } from "../components/FormModal";

type Props = {
  product: Product | null;
  categoryId: string;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
};

export function ProductForm({ product, categoryId, categories, onClose, onSaved }: Props) {
  const [name, setName] = useState(product?.name ?? "");
  const [price, setPrice] = useState(product ? String(product.price).replace(".", ",") : "");
  const [category, setCategory] = useState(product?.categoryId ?? categoryId);
  const [available, setAvailable] = useState(product?.available ?? true);
  const [sortOrder, setSortOrder] = useState(String(product?.sortOrder ?? 0));

  async function save() {
    const value = parseDecimal(price);
    if (!Number.isFinite(value) || value < 0) throw new Error("El precio no es válido");
    const data = { name, price: Math.round(value * 100) / 100, categoryId: category, available, sortOrder: Number(sortOrder) };
    if (product) await api.updateProduct(product.id, data);
    else await api.createProduct(data);
    toast(product ? "Producto guardado" : "Producto creado");
    onSaved();
  }

  return (
    <FormModal title={product ? "Editar producto" : "Nuevo producto"} onSubmit={save} onClose={onClose}>
      <label>
        Nombre
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoFocus />
      </label>
      <label>
        Precio (€)
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          pattern="\d+([.,]\d{1,2})?"
          title="Número con hasta dos decimales, por ejemplo 2,50"
          placeholder="0,00"
          required
        />
      </label>
      <label>
        Categoría
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
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
      <label className="checkbox">
        <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
        Disponible para vender
      </label>
    </FormModal>
  );
}
