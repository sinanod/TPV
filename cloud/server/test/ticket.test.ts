import request from "supertest";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/auth";
import { renderReceiptEmail } from "../src/email/receipt";

const app = createApp();
let portal: string;
let device: string;
let tableToken: string;

/** PNG de prueba: mitad izquierda negra opaca, mitad derecha transparente. */
function samplePng(width = 200, height = 80) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = 0;
      png.data[i + 3] = x < width / 2 ? 255 : 0;
    }
  }
  return PNG.sync.write(png);
}

const auth = () => ({ Authorization: `Bearer ${portal}` });
const design = {
  showTradeName: false,
  headerText: "Tel. 910 000 000\n\n  www.barpepe.es  ",
  footer: "¡Gracias!\nVuelve pronto",
  showTable: false,
  showWaiter: true,
  logoSize: 70,
  logoStyle: "THRESHOLD",
};

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: {
      name: "Bar Logo",
      username: "barlogo",
      passwordHash: await hashPassword("contraseña-segura"),
      staff: { create: { name: "Encargado", pin: "0000", role: "ADMIN" } },
    },
  });
  const zone = await prisma.zone.create({ data: { tenantId: tenant.id, name: "Sala" } });
  tableToken = (await prisma.diningTable.create({ data: { tenantId: tenant.id, zoneId: zone.id, number: 1 } })).qrToken;
  portal = (await request(app).post("/api/auth/login").send({ username: "barlogo", password: "contraseña-segura" })).body.token;
  device = (
    await request(app)
      .post("/api/sync/register")
      .send({ username: "barlogo", password: "contraseña-segura", deviceName: "PC barra" })
  ).body.deviceToken;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("diseño del ticket", () => {
  it("guarda las opciones, limpia los textos y llega al TPV en el snapshot", async () => {
    const res = await request(app).put("/api/portal/settings/ticket").set(auth()).send(design);
    expect(res.status).toBe(200);
    expect(res.body.ticket).toMatchObject({
      showTradeName: false,
      headerText: "Tel. 910 000 000\nwww.barpepe.es",
      footer: "¡Gracias!\nVuelve pronto",
      showTable: false,
      logo: null,
    });

    const tooLong = await request(app)
      .put("/api/portal/settings/ticket")
      .set(auth())
      .send({ ...design, footer: "1\n2\n3\n4\n5" });
    expect(tooLong.status).toBe(400);

    const snapshot = await request(app).get("/api/sync/config").set("Authorization", `Bearer ${device}`);
    expect(snapshot.body.settings.ticket).toMatchObject({ showTradeName: false, showTable: false, footer: "¡Gracias!\nVuelve pronto" });
  });

  it("los datos fiscales ya no tocan el pie del ticket", async () => {
    const res = await request(app)
      .put("/api/portal/settings/business")
      .set(auth())
      .send({ tradeName: "Bar Logo", legalName: "BAR LOGO SL", nif: "B76543214", address: "" });
    expect(res.status).toBe(200);
    expect(res.body.ticket.footer).toBe("¡Gracias!\nVuelve pronto");
  });

  it("sanea el logo (sin transparencia) y el TPV lo descarga por su hash", async () => {
    const res = await request(app)
      .put("/api/portal/settings/ticket/logo")
      .set(auth())
      .send({ pngBase64: samplePng().toString("base64") });
    expect(res.status).toBe(200);
    const logo = res.body.ticket.logo;
    expect(logo).toMatchObject({ width: 200, height: 80, sizePercent: 70, style: "THRESHOLD" });
    expect(logo.dataUrl).toMatch(/^data:image\/png;base64,/);

    const snapshot = await request(app).get("/api/sync/config").set("Authorization", `Bearer ${device}`);
    expect(snapshot.body.settings.ticket.logo.hash).toBe(logo.hash);
    expect(JSON.stringify(snapshot.body)).not.toContain("base64");

    const file = await request(app)
      .get("/api/sync/ticket-logo")
      .set("Authorization", `Bearer ${device}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    const decoded = PNG.sync.read(file.body as Buffer);
    // Lo transparente pasa a blanco (el color del papel); lo opaco se mantiene
    const at = (x: number) => decoded.data[(10 * decoded.width + x) * 4];
    expect(at(10)).toBe(0);
    expect(at(190)).toBe(255);
    expect(decoded.data[3]).toBe(255);

    const pub = await request(app).get(`/api/public/tables/${tableToken}`);
    expect(pub.body.logoUrl).toContain(`/api/public/tables/${tableToken}/logo`);
    expect((await request(app).get(`/api/public/tables/${tableToken}/logo`)).status).toBe(200);
  });

  it("rechaza archivos que no son PNG, logos enormes o en blanco", async () => {
    const send = (buf: Buffer) =>
      request(app).put("/api/portal/settings/ticket/logo").set(auth()).send({ pngBase64: buf.toString("base64") });
    expect((await send(Buffer.from("<svg onload=alert(1)>"))).body.error).toMatch(/PNG válida/);
    expect((await send(samplePng(800, 100))).body.error).toMatch(/576×320/);
    const white = new PNG({ width: 50, height: 50 });
    white.data.fill(255);
    expect((await send(PNG.sync.write(white))).body.error).toMatch(/en blanco/);
  });

  it("el email del ticket lleva el logo y respeta las opciones", async () => {
    const email = await renderReceiptEmail({
      businessName: "Bar Logo",
      legalName: "BAR LOGO SL",
      nif: "B76543214",
      address: "",
      footer: "¡Gracias!\nVuelve pronto",
      showTradeName: false,
      headerText: "Tel. 910 000 000",
      showTable: false,
      logo: samplePng(),
      numSerie: "T1-2026-000001",
      issuedAt: new Date("2026-10-21T10:00:00Z"),
      tableLabel: "Sala · Mesa 1",
      lines: [{ name: "Caña", qty: 1, totalCents: 220 }],
      breakdown: [{ rate: 10, baseCents: 200, quotaCents: 20 }],
      totalCents: 220,
      payments: [{ method: "CARD", amountCents: 220 }],
      qrUrl: null,
    });
    expect(email.html).toContain('src="cid:logo"');
    expect(email.html).not.toContain("<h1");
    expect(email.html).not.toContain("Mesa 1");
    expect(email.html).toContain("¡Gracias!<br>Vuelve pronto");
    expect(email.attachments.map((a) => a.cid)).toEqual(["logo"]);
  });

  it("se puede quitar el logo", async () => {
    const res = await request(app).delete("/api/portal/settings/ticket/logo").set(auth());
    expect(res.body.ticket.logo).toBeNull();
    expect((await request(app).get("/api/sync/ticket-logo").set("Authorization", `Bearer ${device}`)).status).toBe(404);
  });
});
