import { prisma } from "../db";
import { emitToDevices, emitToPortal } from "../realtime";

/** Configuración completa de un restaurante tal y como la recibe su servidor local. */
export async function buildConfigSnapshot(tenantId: string) {
  const [tenant, categories, products, zones, tables, staff] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    prisma.category.findMany({ where: { tenantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.product.findMany({ where: { tenantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.zone.findMany({ where: { tenantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.diningTable.findMany({ where: { tenantId }, orderBy: { number: "asc" } }),
    prisma.staff.findMany({ where: { tenantId }, orderBy: { name: "asc" } }),
  ]);

  return {
    version: tenant.configVersion,
    categories: categories.map((c) => ({ id: c.id, name: c.name, printerTag: c.printerTag, sortOrder: c.sortOrder })),
    products: products.map((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      name: p.name,
      price: p.price,
      available: p.available,
      sortOrder: p.sortOrder,
    })),
    zones: zones.map((z) => ({ id: z.id, name: z.name, sortOrder: z.sortOrder })),
    tables: tables.map((t) => ({ id: t.id, zoneId: t.zoneId, number: t.number, capacity: t.capacity })),
    staff: staff.map((s) => ({ id: s.id, name: s.name, pin: s.pin, role: s.role })),
  };
}

/** Tras cualquier cambio de configuración: sube la versión y avisa a los servidores locales conectados. */
export async function bumpConfig(tenantId: string) {
  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: { configVersion: { increment: 1 } },
  });
  emitToDevices(tenantId, "config:updated", { version: tenant.configVersion });
  emitToPortal(tenantId, "config:updated", { version: tenant.configVersion });
}
