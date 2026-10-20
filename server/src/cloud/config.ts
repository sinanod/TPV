import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { BusinessInfo, getSettings, saveSettings, SifProducer } from "../settings";
import type { AeatEnvironment } from "../fiscal/verifactu";

export interface ConfigSnapshot {
  version: number;
  printers: { id: string; name: string; type: string; address: string; port: number; width: number }[];
  categories: { id: string; name: string; sortOrder: number; printerId: string | null }[];
  products: {
    id: string;
    categoryId: string;
    name: string;
    price: number;
    available: boolean;
    sortOrder: number;
    taxRate: number;
  }[];
  zones: { id: string; name: string; sortOrder: number }[];
  tables: { id: string; zoneId: string; number: number; capacity: number }[];
  staff: { id: string; name: string; pin: string; role: string }[];
  settings: {
    receiptPrinterId: string | null;
    business: BusinessInfo | null;
    verifactu: { enabled: boolean; environment: AeatEnvironment; endDate: string | null };
    sif: SifProducer | null;
  };
  device: { invoiceSeries: string; installationNumber: string };
}

// Lo que no está en el snapshot (borrado en el portal, o creado aquí antes de
// vincular) se desactiva en vez de borrarse: las comandas antiguas lo
// siguen referenciando.
function deactivateMissing(ids: string[]) {
  return { OR: [{ cloudId: null }, { cloudId: { notIn: ids } }] };
}

async function upsertMap<T extends { id: string }>(
  items: T[],
  upsert: (item: T) => Promise<{ id: number }>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const item of items) map.set(item.id, (await upsert(item)).id);
  return map;
}

export async function applyConfig(snapshot: ConfigSnapshot) {
  await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const printerIds = await upsertMap(snapshot.printers, (p) => {
        const fields = { name: p.name, type: p.type, address: p.address, port: p.port, width: p.width };
        return tx.printer.upsert({
          where: { cloudId: p.id },
          create: { cloudId: p.id, ...fields },
          update: { ...fields, active: true },
        });
      });
      await tx.printer.updateMany({ where: deactivateMissing(snapshot.printers.map((p) => p.id)), data: { active: false } });

      const categoryIds = await upsertMap(snapshot.categories, (c) => {
        const fields = {
          name: c.name,
          sortOrder: c.sortOrder,
          printerId: c.printerId ? (printerIds.get(c.printerId) ?? null) : null,
        };
        return tx.category.upsert({
          where: { cloudId: c.id },
          create: { cloudId: c.id, ...fields },
          update: { ...fields, active: true },
        });
      });
      await tx.category.updateMany({ where: deactivateMissing(snapshot.categories.map((c) => c.id)), data: { active: false } });

      for (const p of snapshot.products) {
        const categoryId = categoryIds.get(p.categoryId);
        if (categoryId === undefined) continue;
        const fields = {
          name: p.name,
          price: p.price,
          available: p.available,
          sortOrder: p.sortOrder,
          taxRate: p.taxRate,
          categoryId,
        };
        await tx.product.upsert({
          where: { cloudId: p.id },
          create: { cloudId: p.id, ...fields },
          update: { ...fields, active: true },
        });
      }
      await tx.product.updateMany({ where: deactivateMissing(snapshot.products.map((p) => p.id)), data: { active: false } });

      const zoneIds = await upsertMap(snapshot.zones, (z) =>
        tx.zone.upsert({
          where: { cloudId: z.id },
          create: { cloudId: z.id, name: z.name, sortOrder: z.sortOrder },
          update: { name: z.name, sortOrder: z.sortOrder, active: true },
        }),
      );
      await tx.zone.updateMany({ where: deactivateMissing(snapshot.zones.map((z) => z.id)), data: { active: false } });

      for (const t of snapshot.tables) {
        const zoneId = zoneIds.get(t.zoneId);
        if (zoneId === undefined) continue;
        const fields = { number: t.number, capacity: t.capacity, zoneId };
        await tx.table.upsert({
          where: { cloudId: t.id },
          create: { cloudId: t.id, ...fields },
          update: { ...fields, active: true },
        });
      }
      await tx.table.updateMany({ where: deactivateMissing(snapshot.tables.map((t) => t.id)), data: { active: false } });

      for (const s of snapshot.staff) {
        const fields = { name: s.name, pin: s.pin, role: s.role };
        await tx.user.upsert({
          where: { cloudId: s.id },
          create: { cloudId: s.id, ...fields },
          update: { ...fields, active: true },
        });
      }
      await tx.user.updateMany({ where: deactivateMissing(snapshot.staff.map((s) => s.id)), data: { active: false } });

      const st = snapshot.settings;
      await saveSettings(tx, {
        ...(await getSettings(tx)),
        invoiceSeries: snapshot.device.invoiceSeries,
        installationNumber: snapshot.device.installationNumber,
        receiptPrinterId: st.receiptPrinterId ? (printerIds.get(st.receiptPrinterId) ?? null) : null,
        business: st.business,
        verifactu: st.verifactu,
        sif: st.sif,
      });

      await tx.cloudLink.update({
        where: { id: 1 },
        data: { configVersion: snapshot.version, lastConfigAt: new Date() },
      });
    },
    { timeout: 30_000 },
  );
}
