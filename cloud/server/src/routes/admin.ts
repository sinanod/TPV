import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requirePortal } from "../auth";
import { h, HttpError } from "../lib/http";
import { bumpConfig } from "../lib/configSync";
import { publicBaseUrl } from "../lib/urls";

// Gestión de la configuración del restaurante: carta, salón y personal.
// Cada cambio sube la versión de configuración y se propaga a los servidores
// locales vinculados.
export const adminRouter = Router();
adminRouter.use(requirePortal);

const idParam = z.object({ id: z.string().uuid() });
// Tipos de IVA vigentes en España (el 5 % lo han usado algunas rebajas temporales)
const taxRate = z.union([z.literal(0), z.literal(4), z.literal(5), z.literal(10), z.literal(21)]);
const role = z.enum(["ADMIN", "WAITER", "KITCHEN"]);
const name = z.string().trim().min(1).max(100);
const sortOrder = z.number().int().min(0).max(10_000);

const OWNED_LABEL = { category: "Familia no válida", zone: "Zona no válida", printer: "Impresora no válida" };

async function assertOwned(kind: "category" | "zone" | "printer", id: string, tenantId: string) {
  const where = { id, tenantId };
  const found =
    kind === "category"
      ? await prisma.category.count({ where })
      : kind === "zone"
        ? await prisma.zone.count({ where })
        : await prisma.printer.count({ where });
  if (!found) throw new HttpError(400, OWNED_LABEL[kind]);
}

function notFoundIfZero(count: number) {
  if (count === 0) throw new HttpError(404, "No encontrado");
}

// ---------- Carta: impresoras, familias y productos ----------

adminRouter.get(
  "/catalog",
  h(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { tenantId: req.tenantId! },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { products: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
    });
    res.json(categories);
  }),
);

// Impresoras de cocina/barra/tickets
// NETWORK: impresora térmica con IP (ESC/POS, puerto 9100)
// SYSTEM: impresora instalada en el PC del TPV (USB), por su nombre en el sistema

const printerBase = z.object({
  name,
  type: z.enum(["NETWORK", "SYSTEM"]),
  address: z.string().trim().min(1).max(200),
  port: z.number().int().min(1).max(65535).default(9100),
  width: z.union([z.literal(58), z.literal(80)]).default(80),
});

adminRouter.get(
  "/printers",
  h(async (req, res) => {
    const [printers, devices] = await Promise.all([
      prisma.printer.findMany({ where: { tenantId: req.tenantId! }, orderBy: { name: "asc" } }),
      prisma.device.findMany({ where: { tenantId: req.tenantId!, revokedAt: null }, select: { name: true, systemPrinters: true } }),
    ]);
    res.json({ printers, systemPrinters: devices.map((d) => ({ device: d.name, printers: d.systemPrinters })) });
  }),
);

adminRouter.post(
  "/printers",
  h(async (req, res) => {
    const data = printerBase.parse(req.body);
    const printer = await prisma.printer.create({ data: { ...data, tenantId: req.tenantId! } });
    await bumpConfig(req.tenantId!);
    res.status(201).json(printer);
  }),
);

adminRouter.patch(
  "/printers/:id",
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const data = printerBase.partial().parse(req.body);
    notFoundIfZero((await prisma.printer.updateMany({ where: { id, tenantId: req.tenantId! }, data })).count);
    await bumpConfig(req.tenantId!);
    res.json(await prisma.printer.findUnique({ where: { id } }));
  }),
);

// Las familias que la usaban se quedan sin impresora (no se imprimen)
adminRouter.delete(
  "/printers/:id",
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    notFoundIfZero((await prisma.printer.deleteMany({ where: { id, tenantId: req.tenantId! } })).count);
    await bumpConfig(req.tenantId!);
    res.status(204).end();
  }),
);

// ---------- Familias ----------

const categoryCreate = z.object({
  name,
  sortOrder: sortOrder.default(0),
  printerId: z.string().uuid().nullable().default(null),
});
const categoryUpdate = categoryCreate.partial();

adminRouter.post(
  "/categories",
  h(async (req, res) => {
    const data = categoryCreate.parse(req.body);
    if (data.printerId) await assertOwned("printer", data.printerId, req.tenantId!);
    const category = await prisma.category.create({ data: { ...data, tenantId: req.tenantId! } });
    await bumpConfig(req.tenantId!);
    res.status(201).json(category);
  }),
);

adminRouter.patch(
  "/categories/:id",
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const data = categoryUpdate.parse(req.body);
    if (data.printerId) await assertOwned("printer", data.printerId, req.tenantId!);
    notFoundIfZero((await prisma.category.updateMany({ where: { id, tenantId: req.tenantId! }, data })).count);
    await bumpConfig(req.tenantId!);
    res.json(await prisma.category.findUnique({ where: { id } }));
  }),
);

adminRouter.delete(
  "/categories/:id",
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    if (await prisma.product.count({ where: { categoryId: id, tenantId: req.tenantId! } })) {
      throw new HttpError(409, "La familia tiene productos: bórralos o muévelos antes");
    }
    notFoundIfZero((await prisma.category.deleteMany({ where: { id, tenantId: req.tenantId! } })).count);
    await bumpConfig(req.tenantId!);
    res.status(204).end();
  }),
);

const productCreate = z.object({
  categoryId: z.string().uuid(),
  name,
  price: z.number().min(0).max(100_000),
  taxRate: taxRate.default(10),
  available: z.boolean().default(true),
  sortOrder: sortOrder.default(0),
});
const productUpdate = productCreate.partial();

adminRouter.post(
  "/products",
  h(async (req, res) => {
    const data = productCreate.parse(req.body);
    await assertOwned("category", data.categoryId, req.tenantId!);
    const product = await prisma.product.create({ data: { ...data, tenantId: req.tenantId! } });
    await bumpConfig(req.tenantId!);
    res.status(201).json(product);
  }),
);

adminRouter.patch(
  "/products/:id",
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const data = productUpdate.parse(req.body);
    if (data.categoryId) await assertOwned("category", data.categoryId, req.tenantId!);
    notFoundIfZero((await prisma.product.updateMany({ where: { id, tenantId: req.tenantId! }, data })).count);
    await bumpConfig(req.tenantId!);
    res.json(await prisma.product.findUnique({ where: { id } }));
  }),
);

adminRouter.delete(
  "/products/:id",
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    notFoundIfZero((await prisma.product.deleteMany({ where: { id, tenantId: req.tenantId! } })).count);
    await bumpConfig(req.tenantId!);
    res.status(204).end();
  }),
);

// ---------- Salón ----------

const zoneCreate = z.object({ name, sortOrder: sortOrder.default(0) });
const zoneUpdate = zoneCreate.partial();

adminRouter.post(
  "/zones",
  h(async (req, res) => {
    const data = zoneCreate.parse(req.body);
    const zone = await prisma.zone.create({ data: { ...data, tenantId: req.tenantId! } });
    await bumpConfig(req.tenantId!);
    res.status(201).json(zone);
  }),
);

adminRouter.patch(
  "/zones/:id",
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const data = zoneUpdate.parse(req.body);
    notFoundIfZero((await prisma.zone.updateMany({ where: { id, tenantId: req.tenantId! }, data })).count);
    await bumpConfig(req.tenantId!);
    res.json(await prisma.zone.findUnique({ where: { id } }));
  }),
);

adminRouter.delete(
  "/zones/:id",
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    if (await prisma.diningTable.count({ where: { zoneId: id, tenantId: req.tenantId! } })) {
      throw new HttpError(409, "La zona tiene mesas: bórralas o muévelas antes");
    }
    notFoundIfZero((await prisma.zone.deleteMany({ where: { id, tenantId: req.tenantId! } })).count);
    await bumpConfig(req.tenantId!);
    res.status(204).end();
  }),
);

const tableCreate = z.object({
  zoneId: z.string().uuid(),
  number: z.number().int().min(1).max(10_000),
  capacity: z.number().int().min(1).max(100).default(4),
});
const tableUpdate = tableCreate.partial();

adminRouter.post(
  "/tables",
  h(async (req, res) => {
    const data = tableCreate.parse(req.body);
    await assertOwned("zone", data.zoneId, req.tenantId!);
    const table = await prisma.diningTable.create({ data: { ...data, tenantId: req.tenantId! } });
    await bumpConfig(req.tenantId!);
    res.status(201).json(table);
  }),
);

adminRouter.patch(
  "/tables/:id",
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const data = tableUpdate.parse(req.body);
    if (data.zoneId) await assertOwned("zone", data.zoneId, req.tenantId!);
    notFoundIfZero((await prisma.diningTable.updateMany({ where: { id, tenantId: req.tenantId! }, data })).count);
    await bumpConfig(req.tenantId!);
    res.json(await prisma.diningTable.findUnique({ where: { id } }));
  }),
);

adminRouter.delete(
  "/tables/:id",
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    notFoundIfZero((await prisma.diningTable.deleteMany({ where: { id, tenantId: req.tenantId! } })).count);
    await bumpConfig(req.tenantId!);
    res.status(204).end();
  }),
);

// QR de cada mesa: el cliente lo escanea para ver la cuenta y pagar desde su móvil
adminRouter.get(
  "/tables/qr",
  h(async (req, res) => {
    const base = publicBaseUrl(req);
    const tables = await prisma.diningTable.findMany({
      where: { tenantId: req.tenantId! },
      include: { zone: true },
      orderBy: [{ zone: { sortOrder: "asc" } }, { zone: { name: "asc" } }, { number: "asc" }],
    });
    res.json(
      tables.map((t) => ({ tableId: t.id, label: `${t.zone.name} · Mesa ${t.number}`, url: `${base}/m/${t.qrToken}` })),
    );
  }),
);

// Por si un QR se ha copiado o fotografiado fuera del local
adminRouter.post(
  "/tables/:id/qr/rotate",
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    notFoundIfZero(
      (await prisma.diningTable.updateMany({ where: { id, tenantId: req.tenantId! }, data: { qrToken: randomUUID() } })).count,
    );
    res.status(204).end();
  }),
);

// ---------- Personal (acceso por PIN al TPV local) ----------

const staffCreate = z.object({
  name,
  pin: z.string().regex(/^\d{4,6}$/, "El PIN debe tener entre 4 y 6 dígitos"),
  role: role.default("WAITER"),
});
const staffUpdate = staffCreate.partial();

adminRouter.get(
  "/staff",
  h(async (req, res) => {
    res.json(await prisma.staff.findMany({ where: { tenantId: req.tenantId! }, orderBy: { name: "asc" } }));
  }),
);

adminRouter.post(
  "/staff",
  h(async (req, res) => {
    const data = staffCreate.parse(req.body);
    const staff = await prisma.staff.create({ data: { ...data, tenantId: req.tenantId! } });
    await bumpConfig(req.tenantId!);
    res.status(201).json(staff);
  }),
);

async function findOwnedStaff(id: string, tenantId: string) {
  const staff = await prisma.staff.findFirst({ where: { id, tenantId } });
  if (!staff) throw new HttpError(404, "No encontrado");
  return staff;
}

// Siempre debe quedar al menos un encargado (ADMIN), o nadie podría
// administrar el TPV local.
async function assertOtherAdminExists(tenantId: string, staffId: string) {
  const others = await prisma.staff.count({ where: { tenantId, role: "ADMIN", id: { not: staffId } } });
  if (others === 0) throw new HttpError(409, "Debe quedar al menos un encargado (ADMIN)");
}

adminRouter.patch(
  "/staff/:id",
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const data = staffUpdate.parse(req.body);
    const staff = await findOwnedStaff(id, req.tenantId!);
    if (staff.role === "ADMIN" && data.role && data.role !== "ADMIN") {
      await assertOtherAdminExists(req.tenantId!, id);
    }
    const updated = await prisma.staff.update({ where: { id }, data });
    await bumpConfig(req.tenantId!);
    res.json(updated);
  }),
);

adminRouter.delete(
  "/staff/:id",
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const staff = await findOwnedStaff(id, req.tenantId!);
    if (staff.role === "ADMIN") await assertOtherAdminExists(req.tenantId!, id);
    await prisma.staff.delete({ where: { id } });
    await bumpConfig(req.tenantId!);
    res.status(204).end();
  }),
);
