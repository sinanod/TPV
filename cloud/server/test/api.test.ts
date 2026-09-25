import { randomUUID } from "crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/auth";

const app = createApp();

async function createTenant(username: string) {
  const tenant = await prisma.tenant.create({
    data: {
      name: `Restaurante ${username}`,
      username,
      passwordHash: await hashPassword("contraseña-segura"),
      staff: { create: { name: "Encargado", pin: "0000", role: "ADMIN" } },
    },
  });
  const zone = await prisma.zone.create({ data: { tenantId: tenant.id, name: "Interior" } });
  const table = await prisma.diningTable.create({ data: { tenantId: tenant.id, zoneId: zone.id, number: 1 } });
  const category = await prisma.category.create({ data: { tenantId: tenant.id, name: "Bebidas" } });
  const product = await prisma.product.create({
    data: { tenantId: tenant.id, categoryId: category.id, name: "Caña", price: 2.2 },
  });
  return { tenant, zone, table, category, product };
}

async function portalToken(username: string) {
  const res = await request(app).post("/api/auth/login").send({ username, password: "contraseña-segura" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function deviceToken(username: string) {
  const res = await request(app)
    .post("/api/sync/register")
    .send({ username, password: "contraseña-segura", deviceName: "PC barra" });
  expect(res.status).toBe(201);
  return res.body.deviceToken as string;
}

function orderEvent(tableId: string, at: string, overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    type: "order.upsert",
    at,
    data: {
      localUuid: "local-order-1",
      tableId,
      tableLabel: "Interior · Mesa 1",
      waiterName: "Ana",
      status: "SENT",
      paymentMethod: null,
      total: 4.4,
      openedAt: "2026-01-10T12:00:00.000Z",
      closedAt: null,
      lines: [{ productId: null, productName: "Caña", qty: 2, unitPrice: 2.2, note: null, status: "SENT" }],
      ...overrides,
    },
  };
}

let a: Awaited<ReturnType<typeof createTenant>>;
let b: Awaited<ReturnType<typeof createTenant>>;
let tokenA: string;
let tokenB: string;
let deviceA: string;

beforeAll(async () => {
  a = await createTenant("rest-a");
  b = await createTenant("rest-b");
  tokenA = await portalToken("rest-a");
  tokenB = await portalToken("rest-b");
  deviceA = await deviceToken("rest-a");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("autenticación", () => {
  it("rechaza credenciales incorrectas", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "rest-a", password: "mala" });
    expect(res.status).toBe(401);
  });

  it("rechaza cuentas desactivadas aunque el token siga vigente", async () => {
    const c = await createTenant("rest-c");
    const token = await portalToken("rest-c");
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { active: false } });
    const res = await request(app).get("/api/portal/catalog").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("un token de dispositivo no sirve para el portal ni viceversa", async () => {
    const asPortal = await request(app).get("/api/portal/catalog").set("Authorization", `Bearer ${deviceA}`);
    expect(asPortal.status).toBe(401);
    const asDevice = await request(app).get("/api/sync/config").set("Authorization", `Bearer ${tokenA}`);
    expect(asDevice.status).toBe(401);
  });
});

describe("aislamiento entre restaurantes", () => {
  it("cada restaurante solo ve su carta", async () => {
    const res = await request(app).get("/api/portal/catalog").set("Authorization", `Bearer ${tokenA}`);
    const productIds = res.body.flatMap((c: { products: { id: string }[] }) => c.products.map((p) => p.id));
    expect(productIds).toContain(a.product.id);
    expect(productIds).not.toContain(b.product.id);
  });

  it("no puede modificar ni borrar productos de otro restaurante", async () => {
    const patch = await request(app)
      .patch(`/api/portal/products/${b.product.id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ price: 0.01 });
    expect(patch.status).toBe(404);
    const del = await request(app).delete(`/api/portal/products/${b.product.id}`).set("Authorization", `Bearer ${tokenA}`);
    expect(del.status).toBe(404);
    const product = await prisma.product.findUnique({ where: { id: b.product.id } });
    expect(product?.price).toBe(2.2);
  });

  it("no puede crear productos en categorías de otro restaurante", async () => {
    const res = await request(app)
      .post("/api/portal/products")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ categoryId: b.category.id, name: "Intruso", price: 1 });
    expect(res.status).toBe(400);
  });

  it("los eventos de un dispositivo no pueden tocar mesas de otro restaurante", async () => {
    await request(app)
      .post("/api/sync/events")
      .set("Authorization", `Bearer ${deviceA}`)
      .send({
        events: [
          { id: randomUUID(), type: "table.status", at: new Date().toISOString(), data: { tableId: b.table.id, status: "OCCUPIED" } },
        ],
      });
    const table = await prisma.diningTable.findUnique({ where: { id: b.table.id } });
    expect(table?.status).toBe("FREE");
  });
});

describe("configuración", () => {
  it("cada cambio sube la versión que ve el dispositivo", async () => {
    const before = await request(app).get("/api/sync/config").set("Authorization", `Bearer ${deviceA}`);
    await request(app)
      .post("/api/portal/products")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ categoryId: a.category.id, name: "Vermut", price: 3 })
      .expect(201);
    const after = await request(app).get("/api/sync/config").set("Authorization", `Bearer ${deviceA}`);
    expect(after.body.version).toBe(before.body.version + 1);
    expect(after.body.products.map((p: { name: string }) => p.name)).toContain("Vermut");
  });

  it("no permite dejar el restaurante sin encargado", async () => {
    const admin = await prisma.staff.findFirstOrThrow({ where: { tenantId: a.tenant.id, role: "ADMIN" } });
    const del = await request(app).delete(`/api/portal/staff/${admin.id}`).set("Authorization", `Bearer ${tokenA}`);
    expect(del.status).toBe(409);
    const demote = await request(app)
      .patch(`/api/portal/staff/${admin.id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ role: "WAITER" });
    expect(demote.status).toBe(409);
  });

  it("rechaza PIN duplicado dentro del mismo restaurante pero no entre restaurantes", async () => {
    const dupe = await request(app)
      .post("/api/portal/staff")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Otro", pin: "0000" });
    expect(dupe.status).toBe(409);
    const ok = await request(app)
      .post("/api/portal/staff")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Marta", pin: "1234" });
    expect(ok.status).toBe(201);
  });
});

describe("sincronización de operación", () => {
  it("aplica comandas, ignora eventos antiguos y refleja el cobro en ventas", async () => {
    const auth = { Authorization: `Bearer ${deviceA}` };

    await request(app)
      .post("/api/sync/events")
      .set(auth)
      .send({
        events: [
          { id: randomUUID(), type: "table.status", at: "2026-01-10T12:00:00.000Z", data: { tableId: a.table.id, status: "OCCUPIED" } },
          orderEvent(a.table.id, "2026-01-10T12:05:00.000Z"),
        ],
      })
      .expect(200);

    // Un reintento viejo (total distinto) no debe pisar el estado actual
    await request(app)
      .post("/api/sync/events")
      .set(auth)
      .send({ events: [orderEvent(a.table.id, "2026-01-10T12:01:00.000Z", { total: 99 })] })
      .expect(200);

    const open = await request(app).get("/api/portal/orders/open").set("Authorization", `Bearer ${tokenA}`);
    expect(open.body).toHaveLength(1);
    expect(open.body[0].total).toBe(4.4);
    expect(open.body[0].lines).toHaveLength(1);

    const floor = await request(app).get("/api/portal/floor").set("Authorization", `Bearer ${tokenA}`);
    expect(floor.body[0].tables[0].status).toBe("OCCUPIED");
    expect(floor.body[0].tables[0].openOrder.total).toBe(4.4);

    // Cobro
    await request(app)
      .post("/api/sync/events")
      .set(auth)
      .send({
        events: [
          orderEvent(a.table.id, "2026-01-10T13:00:00.000Z", {
            status: "PAID",
            paymentMethod: "CARD",
            closedAt: "2026-01-10T13:00:00.000Z",
          }),
          { id: randomUUID(), type: "table.status", at: "2026-01-10T13:00:00.000Z", data: { tableId: a.table.id, status: "FREE" } },
        ],
      })
      .expect(200);

    const sales = await request(app)
      .get("/api/portal/sales")
      .query({ from: "2026-01-10T00:00:00.000Z", to: "2026-01-11T00:00:00.000Z" })
      .set("Authorization", `Bearer ${tokenA}`);
    expect(sales.body.totals).toMatchObject({ revenue: 4.4, count: 1, byPayment: { CARD: 4.4 } });

    const openAfter = await request(app).get("/api/portal/orders/open").set("Authorization", `Bearer ${tokenA}`);
    expect(openAfter.body).toHaveLength(0);

    // El otro restaurante no ve esas ventas
    const salesB = await request(app)
      .get("/api/portal/sales")
      .query({ from: "2026-01-10T00:00:00.000Z", to: "2026-01-11T00:00:00.000Z" })
      .set("Authorization", `Bearer ${tokenB}`);
    expect(salesB.body.totals.count).toBe(0);
  });

  it("un evento mal formado se rechaza sin bloquear el resto del lote", async () => {
    const res = await request(app)
      .post("/api/sync/events")
      .set("Authorization", `Bearer ${deviceA}`)
      .send({
        events: [
          { id: "roto", type: "order.upsert", at: "no-es-fecha", data: {} },
          { id: "ok", type: "table.status", at: new Date().toISOString(), data: { tableId: a.table.id, status: "FREE" } },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toEqual(["ok"]);
    expect(res.body.rejected.map((r: { id: string }) => r.id)).toEqual(["roto"]);
  });

  it("un dispositivo revocado deja de poder sincronizar", async () => {
    const token = await deviceToken("rest-b");
    const device = await prisma.device.findFirstOrThrow({ where: { tenantId: b.tenant.id }, orderBy: { createdAt: "desc" } });
    await request(app).delete(`/api/portal/devices/${device.id}`).set("Authorization", `Bearer ${tokenB}`).expect(204);
    const res = await request(app).get("/api/sync/config").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
