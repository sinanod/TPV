import { prisma } from "../db";
import { config } from "../config";
import { emitToDevices, emitToPortal } from "../realtime";

export async function getTenantSettings(tenantId: string) {
  return prisma.tenantSettings.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
}

/** Configuración completa de un restaurante tal y como la recibe uno de sus TPV. */
export async function buildConfigSnapshot(tenantId: string, deviceId: string) {
  const [tenant, settings, device, printers, categories, products, zones, tables, staff] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    getTenantSettings(tenantId),
    prisma.device.findUniqueOrThrow({ where: { id: deviceId } }),
    prisma.printer.findMany({ where: { tenantId }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { tenantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.product.findMany({ where: { tenantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.zone.findMany({ where: { tenantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.diningTable.findMany({ where: { tenantId }, orderBy: { number: "asc" } }),
    prisma.staff.findMany({ where: { tenantId }, orderBy: { name: "asc" } }),
  ]);

  const hasFiscalData = !!(settings.nif && settings.legalName);
  return {
    version: tenant.configVersion,
    printers: printers.map((p) => ({ id: p.id, name: p.name, type: p.type, address: p.address, port: p.port, width: p.width })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder, printerId: c.printerId })),
    products: products.map((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      name: p.name,
      price: p.price,
      taxRate: p.taxRate,
      available: p.available,
      sortOrder: p.sortOrder,
    })),
    zones: zones.map((z) => ({ id: z.id, name: z.name, sortOrder: z.sortOrder })),
    tables: tables.map((t) => ({ id: t.id, zoneId: t.zoneId, number: t.number, capacity: t.capacity })),
    staff: staff.map((s) => ({ id: s.id, name: s.name, pin: s.pin, role: s.role })),
    settings: {
      receiptPrinterId: settings.receiptPrinterId,
      business: hasFiscalData
        ? {
            name: settings.tradeName || tenant.name,
            legalName: settings.legalName,
            nif: settings.nif,
            address: settings.address,
            ticketFooter: settings.ticketFooter,
          }
        : null,
      verifactu: {
        enabled: settings.verifactuEnabled,
        environment: settings.verifactuEnvironment,
        endDate: settings.verifactuEndDate ? settings.verifactuEndDate.toISOString().slice(0, 10) : null,
      },
      sif: config.sif,
    },
    device: { invoiceSeries: `T${device.seriesNumber}`, installationNumber: device.id },
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
