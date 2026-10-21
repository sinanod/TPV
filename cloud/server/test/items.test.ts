import { randomUUID } from "crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/auth";

const app = createApp();
let portal: string;
let device: string;
let tableId: string;
let token: string;
const orderUuid = randomUUID();

const sendEvents = (events: unknown[]) =>
  request(app).post("/api/sync/events").set("Authorization", `Bearer ${device}`).send({ events });

/** La comanda tal y como la sube el TPV: 3 cañas (1 ya pagada eligiendo artículos) y unas bravas. */
function orderEvent(paidCañas: number) {
  return {
    id: randomUUID(),
    type: "order.upsert",
    at: new Date().toISOString(),
    data: {
      localUuid: orderUuid,
      tableId,
      tableLabel: "Sala · Mesa 1",
      waiterName: "Ana",
      status: "SENT",
      paymentMethod: null,
      total: 13.1,
      openedAt: new Date().toISOString(),
      closedAt: null,
      lines: [
        { localId: 11, paidQty: paidCañas, productId: null, productName: "Caña", qty: 3, unitPrice: 2.2, note: null, status: "SENT" },
        { localId: 12, paidQty: 0, productId: null, productName: "Patatas bravas", qty: 1, unitPrice: 6.5, note: null, status: "SENT" },
      ],
      payments: paidCañas
        ? [
            {
              uuid: randomUUID(),
              method: "CASH",
              amountCents: 220 * paidCañas,
              tenderedCents: null,
              refundCents: 0,
              onlinePaymentId: null,
              createdAt: new Date().toISOString(),
              items: [{ lineId: 11, qty: paidCañas }],
            },
          ]
        : [],
    },
  };
}

const bill = async () => (await request(app).get(`/api/public/tables/${token}`)).body.bill;
const pay = (body: unknown) => request(app).post(`/api/public/tables/${token}/payments`).send(body);

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: {
      name: "Bar Items",
      username: "baritems",
      passwordHash: await hashPassword("contraseña-segura"),
      settings: { create: { onlinePaymentsEnabled: true } },
    },
  });
  const zone = await prisma.zone.create({ data: { tenantId: tenant.id, name: "Sala" } });
  const table = await prisma.diningTable.create({ data: { tenantId: tenant.id, zoneId: zone.id, number: 1 } });
  tableId = table.id;
  token = table.qrToken;
  portal = (await request(app).post("/api/auth/login").send({ username: "baritems", password: "contraseña-segura" })).body.token;
  device = (
    await request(app).post("/api/sync/register").send({ username: "baritems", password: "contraseña-segura", deviceName: "PC" })
  ).body.deviceToken;
  void portal;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("pago del cliente eligiendo artículos", () => {
  it("la cuenta pública dice qué queda por pagar de cada artículo", async () => {
    const res = await sendEvents([orderEvent(1)]);
    expect(res.body.rejected).toEqual([]);
    expect(await bill()).toMatchObject({
      totalCents: 1310,
      paidCents: 220,
      pendingCents: 1090,
      lines: [
        { lineId: 11, name: "Caña", qty: 3, unitCents: 220, availableQty: 2 },
        { lineId: 12, name: "Patatas bravas", qty: 1, unitCents: 650, availableQty: 1 },
      ],
    });
    // El pago con sus artículos queda guardado en la nube
    const payment = await prisma.orderPayment.findFirstOrThrow({ where: { order: { localUuid: orderUuid } } });
    expect(payment.items).toEqual([{ lineId: 11, qty: 1 }]);
  });

  it("el importe lo calcula el servidor y no se puede pagar lo ya pagado", async () => {
    const over = await pay({ items: [{ lineId: 11, qty: 3 }] });
    expect(over.status).toBe(409);
    expect((await pay({ items: [{ lineId: 99, qty: 1 }] })).status).toBe(400);

    // Aunque el cliente mande otro importe, cuenta lo que valen los artículos
    const ok = await pay({ items: [{ lineId: 11, qty: 1 }, { lineId: 12, qty: 1 }], amountCents: 1, email: "yo@ejemplo.com" });
    expect(ok.status).toBe(201);
    expect(ok.body.amountCents).toBe(870);
    await request(app).post(`/api/public/payments/${ok.body.paymentId}/demo/confirm`).expect(200);

    // Mientras el TPV no lo registra, esos artículos ya no se ofrecen a otro comensal
    const b = await bill();
    expect(b.pendingCents).toBe(220);
    expect(b.lines.map((l: { availableQty: number }) => l.availableQty)).toEqual([1, 0]);
    expect((await pay({ items: [{ lineId: 12, qty: 1 }] })).status).toBe(409);

    // El TPV recibe los artículos para registrarlos
    const feed = await request(app).get("/api/sync/online-payments").set("Authorization", `Bearer ${device}`);
    expect(feed.body).toEqual([
      expect.objectContaining({ id: ok.body.paymentId, amountCents: 870, items: [{ lineId: 11, qty: 1 }, { lineId: 12, qty: 1 }] }),
    ]);
  });

  it("si antes se pagó una parte por importe, los artículos cuestan como mucho lo pendiente", async () => {
    await prisma.onlinePayment.updateMany({ where: { orderLocalUuid: orderUuid }, data: { status: "CANCELLED" } });
    const upsert = orderEvent(0);
    upsert.data.payments = [
      { uuid: randomUUID(), method: "CARD", amountCents: 1200, tenderedCents: null, refundCents: 0, onlinePaymentId: null, createdAt: new Date().toISOString(), items: [] },
    ];
    await sendEvents([upsert]);
    const res = await pay({ items: [{ lineId: 12, qty: 1 }] });
    expect(res.body.amountCents).toBe(110);
  });
});
