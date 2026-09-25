import { useState } from "react";
import type { Category, Product } from "../types";
import { api } from "../lib/api";
import { money, PRINTER_TAG } from "../lib/format";
import { confirmAndRun, toast } from "../lib/notify";
import { useResource } from "../lib/useResource";
import { LoadState, PageHeader } from "../components/common";
import { CategoryForm } from "./CategoryForm";
import { ProductForm } from "./ProductForm";

type Editing =
  | { kind: "category"; category: Category | null }
  | { kind: "product"; product: Product | null; categoryId: string }
  | null;

export function CatalogPage() {
  const catalog = useResource(api.catalog, ["config:updated"]);
  const [editing, setEditing] = useState<Editing>(null);
  const categories = catalog.data;

  async function toggleAvailable(p: Product) {
    const available = !p.available;
    catalog.setData((cats) =>
      cats && cats.map((c) => ({ ...c, products: c.products.map((x) => (x.id === p.id ? { ...x, available } : x)) })),
    );
    try {
      await api.updateProduct(p.id, { available });
    } catch (e) {
      toast((e as Error).message, "error");
    }
    catalog.reload();
  }

  async function removeCategory(c: Category) {
    const ok = await confirmAndRun(`¿Borrar la categoría «${c.name}»?`, () => api.deleteCategory(c.id), "Categoría borrada");
    if (ok) catalog.reload();
  }

  async function removeProduct(p: Product) {
    const ok = await confirmAndRun(`¿Borrar el producto «${p.name}»?`, () => api.deleteProduct(p.id), "Producto borrado");
    if (ok) catalog.reload();
  }

  return (
    <>
      <PageHeader title="Carta">
        <button className="btn primary" onClick={() => setEditing({ kind: "category", category: null })}>
          Nueva categoría
        </button>
      </PageHeader>
      <p className="muted small intro">Los cambios se envían automáticamente a los TPV del restaurante.</p>

      <LoadState error={catalog.error} loading={!categories} />
      {categories?.length === 0 && <p className="muted panel">Aún no hay categorías. Crea la primera.</p>}

      {categories?.map((c) => (
        <section key={c.id} className="panel" data-testid={`category-${c.name}`}>
          <div className="panel-header">
            <div>
              <h2>{c.name}</h2>
              <span className="muted small">
                Impresora: {PRINTER_TAG[c.printerTag]} · Orden {c.sortOrder}
              </span>
            </div>
            <div className="row-actions">
              <button className="btn small" onClick={() => setEditing({ kind: "product", product: null, categoryId: c.id })}>
                Añadir producto
              </button>
              <button className="btn small ghost" onClick={() => setEditing({ kind: "category", category: c })}>
                Editar
              </button>
              <button className="btn small danger" onClick={() => removeCategory(c)}>
                Borrar
              </button>
            </div>
          </div>

          {c.products.length === 0 ? (
            <p className="muted small">Sin productos.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table fixed">
                <colgroup>
                  <col />
                  <col className="col-num" />
                  <col className="col-num" />
                  <col className="col-num" />
                  <col className="col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Precio</th>
                    <th>Disponible</th>
                    <th className="num">Orden</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {c.products.map((p) => (
                    <tr key={p.id} className={p.available ? undefined : "dimmed"}>
                      <td className="wrap">{p.name}</td>
                      <td className="num">{money(p.price)}</td>
                      <td>
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={p.available}
                            onChange={() => toggleAvailable(p)}
                            aria-label={`${p.name} disponible`}
                          />
                          <span>{p.available ? "Sí" : "No"}</span>
                        </label>
                      </td>
                      <td className="num">{p.sortOrder}</td>
                      <td className="row-actions">
                        <button
                          className="btn small ghost"
                          onClick={() => setEditing({ kind: "product", product: p, categoryId: c.id })}
                        >
                          Editar
                        </button>
                        <button className="btn small danger" onClick={() => removeProduct(p)}>
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

      {editing?.kind === "category" && (
        <CategoryForm category={editing.category} onClose={() => setEditing(null)} onSaved={catalog.reload} />
      )}
      {editing?.kind === "product" && categories && (
        <ProductForm
          product={editing.product}
          categoryId={editing.categoryId}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={catalog.reload}
        />
      )}
    </>
  );
}
