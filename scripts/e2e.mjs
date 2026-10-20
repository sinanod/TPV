// E2E: TPV local + nube como procesos reales, con AEAT (mTLS), SMTP e
// impresora de tickets simulados. Recorre vinculación, familias/impresoras,
// cobro dividido con email, factura VERI*FACTU enviada a la AEAT y pago desde
// el QR de la mesa aplicado en el TPV.
//
// Requisitos: PostgreSQL con el usuario tpv/tpv (como en cloud/server/.env),
// psql, dependencias instaladas en server/ y cloud/server/, y los
// certificados de prueba (se generan con `npm test` en cloud/server).
//
//   node scripts/e2e.mjs
//
// Usa la base de datos tpv_e2e (la borra y la crea) y los puertos 8095, 4005,
// 8444, 2527 y 9103. Los logs quedan en el directorio que imprime al empezar.
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "tpv-e2e-"));
console.log("Logs en", OUT);
const CERTS = `${ROOT}/cloud/server/test/.certs`;
if (!fs.existsSync(`${CERTS}/client.pfx`)) {
  console.error("Faltan los certificados de prueba: ejecuta antes `npm test` en cloud/server");
  process.exit(1);
}
const require = createRequire(`${ROOT}/cloud/server/package.json`);
const { SMTPServer } = require("smtp-server");

const CLOUD = "http://127.0.0.1:8095";
const LOCAL = "http://127.0.0.1:4005";
const DB_URL = "postgresql://tpv:tpv@localhost:5432/tpv_e2e?schema=public";
const procs = [];
const log = (...a) => console.log("•", ...a);
let failures = 0;
const check = (ok, what) => {
  console.log(ok ? "  ✔" : "  ✘", what);
  if (!ok) failures++;
};

async function waitFor(fn, what, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function api(base, method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text}`);
  return data;
}

function start(name, cwd, env) {
  const p = spawn("npx", ["tsx", "src/index.ts"], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const file = fs.createWriteStream(`${OUT}/${name}.log`);
  p.stdout.pipe(file);
  p.stderr.pipe(file);
  procs.push(p);
  return p;
}

// ---------- Simuladores ----------
const aeatBodies = [];
const aeat = https.createServer(
  {
    key: fs.readFileSync(`${CERTS}/server.key`),
    cert: fs.readFileSync(`${CERTS}/server.pem`),
    ca: fs.readFileSync(`${CERTS}/ca.pem`),
    requestCert: true,
    rejectUnauthorized: true,
  },
  (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      aeatBodies.push(body);
      const nif = body.match(/<sum1:NIF>([^<]+)</)[1];
      const own = [...body.matchAll(/<sf:IDFactura><sf:IDEmisorFactura>[^<]+<\/sf:IDEmisorFactura><sf:NumSerieFactura>([^<]+)<\/sf:NumSerieFactura><sf:FechaExpedicionFactura>([^<]+)</g)];
      const ns = 'xmlns:sfR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd" xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd"';
      const lines = own
        .map(([, n, f]) => `<sfR:RespuestaLinea><sfR:IDFactura><sf:IDEmisorFactura>${nif}</sf:IDEmisorFactura><sf:NumSerieFactura>${n}</sf:NumSerieFactura><sf:FechaExpedicionFactura>${f}</sf:FechaExpedicionFactura></sfR:IDFactura><sfR:Operacion><sf:TipoOperacion>Alta</sf:TipoOperacion></sfR:Operacion><sfR:EstadoRegistro>Correcto</sfR:EstadoRegistro></sfR:RespuestaLinea>`)
        .join("");
      res.writeHead(200, { "Content-Type": "text/xml; charset=UTF-8" });
      res.end(
        `<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><sfR:RespuestaRegFactuSistemaFacturacion ${ns}><sfR:CSV>A-E2ECSV000001</sfR:CSV><sfR:DatosPresentacion><sf:NIFPresentador>${nif}</sf:NIFPresentador><sf:TimestampPresentacion>2026-10-20T12:00:00+02:00</sf:TimestampPresentacion></sfR:DatosPresentacion><sfR:Cabecera><sf:ObligadoEmision><sf:NombreRazon>X</sf:NombreRazon><sf:NIF>${nif}</sf:NIF></sf:ObligadoEmision></sfR:Cabecera><sfR:TiempoEsperaEnvio>1</sfR:TiempoEsperaEnvio><sfR:EstadoEnvio>Correcto</sfR:EstadoEnvio>${lines}</sfR:RespuestaRegFactuSistemaFacturacion></env:Body></env:Envelope>`,
      );
    });
  },
);
await new Promise((r) => aeat.listen(8444, "127.0.0.1", r));

const mails = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  onData(stream, session, cb) {
    let data = "";
    stream.on("data", (c) => (data += c));
    stream.on("end", () => {
      mails.push({ to: session.envelope.rcptTo.map((r) => r.address), data });
      cb();
    });
  },
});
await new Promise((r) => smtp.listen(2527, "127.0.0.1", r));

const printed = [];
const printer = net.createServer((s) => {
  const chunks = [];
  s.on("data", (c) => chunks.push(c));
  s.on("end", () => printed.push(Buffer.concat(chunks)));
});
await new Promise((r) => printer.listen(9103, "127.0.0.1", r));

try {
  // ---------- Nube ----------
  log("Preparando la base de datos de la nube (tpv_e2e)");
  execSync(`psql "postgresql://tpv:tpv@localhost:5432/postgres" -c "DROP DATABASE IF EXISTS tpv_e2e" -c "CREATE DATABASE tpv_e2e"`, { stdio: "ignore" });
  const cloudEnv = {
    DATABASE_URL: DB_URL,
    PORT: "8095",
    JWT_SECRET: "e2e-secret",
    PUBLIC_BASE_URL: CLOUD,
    SIF_PRODUCER_NAME: "Software TPV SL",
    SIF_PRODUCER_NIF: "B12345674",
    PAYMENT_PROVIDER: "demo",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "2527",
    MAIL_FROM: "Tickets <tickets@tpv.test>",
    AEAT_ENDPOINT_OVERRIDE: "https://127.0.0.1:8444/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
    AEAT_EXTRA_CA_FILE: `${CERTS}/ca.pem`,
  };
  execSync("npx prisma migrate deploy", { cwd: `${ROOT}/cloud/server`, env: { ...process.env, ...cloudEnv }, stdio: "ignore" });
  execSync(`npm run -s tenant -- create --name "Bar Pepe" --username barpepe --password contraseña-segura --demo`, {
    cwd: `${ROOT}/cloud/server`,
    env: { ...process.env, ...cloudEnv },
    stdio: "ignore",
  });
  start("cloud", `${ROOT}/cloud/server`, cloudEnv);
  await waitFor(() => fetch(`${CLOUD}/api/health`).then((r) => r.ok), "nube arrancada");

  const { token: portal } = await api(CLOUD, "POST", "/api/auth/login", { username: "barpepe", password: "contraseña-segura" });
  log("Portal: impresoras de las familias apuntando a la impresora simulada");
  for (const p of (await api(CLOUD, "GET", "/api/portal/printers", undefined, portal)).printers) {
    await api(CLOUD, "PATCH", `/api/portal/printers/${p.id}`, { name: p.name, type: "NETWORK", address: "127.0.0.1", port: 9103, width: 80 }, portal);
  }
  const { printers } = await api(CLOUD, "GET", "/api/portal/printers", undefined, portal);
  const cocina = printers.find((p) => p.name === "Cocina");
  log("Portal: datos fiscales, certificado, VERI*FACTU (pruebas) y pago desde el móvil");
  await api(CLOUD, "PUT", "/api/portal/settings/business", { tradeName: "Bar Pepe", legalName: "BAR PEPE SL", nif: "B76543214", address: "C/ Mayor 1, Madrid", ticketFooter: "¡Gracias!", receiptPrinterId: cocina.id }, portal);
  await api(CLOUD, "PUT", "/api/portal/settings/certificate", { pfxBase64: fs.readFileSync(`${CERTS}/client.pfx`).toString("base64"), password: "secreto" }, portal);
  await api(CLOUD, "PUT", "/api/portal/settings/verifactu", { enabled: true, environment: "TEST", certificateKind: "PERSONAL" }, portal);
  await api(CLOUD, "PUT", "/api/portal/settings/online-payments", { enabled: true }, portal);

  // ---------- TPV local ----------
  log("TPV local: base de datos nueva y vinculación con la nube");
  const localEnv = { DATABASE_URL: `file:${OUT}/local.db`, PORT: "4005", JWT_SECRET: "e2e-local" };
  fs.rmSync(`${OUT}/local.db`, { force: true });
  execSync("npx prisma migrate deploy", { cwd: `${ROOT}/server`, env: { ...process.env, ...localEnv }, stdio: "ignore" });
  start("local", `${ROOT}/server`, localEnv);
  await waitFor(() => fetch(`${LOCAL}/api/health`).then((r) => r.ok), "TPV local arrancado");
  await api(LOCAL, "POST", "/api/setup/cloud/link", { cloudUrl: CLOUD, username: "barpepe", password: "contraseña-segura", deviceName: "PC barra" });
  const status = await api(LOCAL, "GET", "/api/setup/cloud");
  check(status.linked !== false, `vinculado (${JSON.stringify(status).slice(0, 120)}…)`);

  const { token: waiter } = await api(LOCAL, "POST", "/api/auth/login", { pin: "0000" });
  const categories = await api(LOCAL, "GET", "/api/categories", undefined, waiter);
  check(categories.length === 3 && categories.every((c) => c.printerId), "carta y familias con impresora recibidas de la nube");
  const product = (name) => categories.flatMap((c) => c.products).find((p) => p.name === name);
  const zones = await api(LOCAL, "GET", "/api/zones", undefined, waiter);
  const [t1, t2] = zones.flatMap((z) => z.tables);

  // ---------- Cobro dividido en el TPV con email ----------
  log("Mesa A: comanda, envío a cocina/barra y cobro en dos partes con email");
  await api(LOCAL, "POST", `/api/tables/${t1.id}/open`, {}, waiter);
  let order = await api(LOCAL, "GET", `/api/orders/table/${t1.id}`, undefined, waiter);
  await api(LOCAL, "POST", `/api/orders/${order.id}/lines`, { lines: [{ productId: product("Caña").id, qty: 2 }, { productId: product("Patatas bravas").id, qty: 1 }] }, waiter);
  const sent = await api(LOCAL, "POST", `/api/orders/${order.id}/send`, {}, waiter);
  check(sent.prints.length === 2 && sent.prints.every((p) => p.ok), `comanda impresa en ${sent.prints.map((p) => p.printerName).join(" y ")}`);
  const p1 = await api(LOCAL, "POST", `/api/orders/${order.id}/payments`, { method: "CARD", amount: 5.45 }, waiter);
  check(p1.invoice === null && Math.abs(p1.order.pending - 5.45) < 0.001, "primer pago parcial: queda 5,45 €");
  const p2 = await api(LOCAL, "POST", `/api/orders/${order.id}/payments`, { method: "CASH", amount: 5.45, tendered: 20, email: "cliente@ejemplo.com" }, waiter);
  check(p2.invoice?.numSerie?.startsWith("T1-"), `factura ${p2.invoice?.numSerie}, cambio ${p2.change} €`);
  check(p2.receiptPrint?.ok === true, "ticket con QR impreso");

  await api(LOCAL, "POST", "/api/setup/cloud/sync");
  const inv = await waitFor(async () => {
    const list = await api(CLOUD, "GET", `/api/portal/invoices?from=${new Date(Date.now() - 864e5).toISOString()}&to=${new Date(Date.now() + 864e5).toISOString()}`, undefined, portal);
    const i = list.find((x) => x.numSerie === p2.invoice.numSerie);
    return i && i.aeatStatus === "CORRECT" ? i : null;
  }, "factura aceptada por la AEAT simulada", 40000);
  check(inv.aeatCsv === "A-E2ECSV000001", `AEAT: ${inv.aeatStatus}, CSV ${inv.aeatCsv}`);
  check(aeatBodies.some((b) => b.includes(`<sf:NumSerieFactura>${p2.invoice.numSerie}</sf:NumSerieFactura>`)), "el registro llegó a la AEAT por mTLS");
  const mail = await waitFor(async () => mails.find((m) => m.to.includes("cliente@ejemplo.com")), "email al cliente", 40000);
  check(/cid:qr-tributario/.test(mail.data) && mail.data.includes(p2.invoice.numSerie), "email del ticket con el QR tributario");

  // ---------- Pago desde el móvil del cliente ----------
  log("Mesa B: el cliente paga desde el QR de la mesa");
  await api(LOCAL, "POST", `/api/tables/${t2.id}/open`, {}, waiter);
  order = await api(LOCAL, "GET", `/api/orders/table/${t2.id}`, undefined, waiter);
  await api(LOCAL, "POST", `/api/orders/${order.id}/lines`, { lines: [{ productId: product("Tortilla española").id, qty: 1 }] }, waiter);
  await api(LOCAL, "POST", `/api/orders/${order.id}/send`, {}, waiter);
  await api(LOCAL, "POST", "/api/setup/cloud/sync");

  const qrs = await api(CLOUD, "GET", "/api/portal/tables/qr", undefined, portal);
  const label = `${zones.find((z) => z.tables.some((t) => t.id === t2.id)).name} · Mesa ${t2.number}`;
  const token = qrs.find((q) => q.label === label).url.split("/m/")[1];
  const bill = await waitFor(async () => {
    const b = await api(CLOUD, "GET", `/api/public/tables/${token}`);
    return b.bill?.pendingCents > 0 ? b : null;
  }, "cuenta visible desde el móvil");
  check(bill.bill.pendingCents === 700, `el móvil ve la cuenta: ${bill.bill.pendingCents / 100} €`);
  const pay = await api(CLOUD, "POST", `/api/public/tables/${token}/payments`, { amountCents: 700, email: "movil@ejemplo.com" });
  await api(CLOUD, "POST", `/api/public/payments/${pay.paymentId}/demo/confirm`);

  const closed = await waitFor(async () => {
    const r = await fetch(`${LOCAL}/api/orders/table/${t2.id}`, { headers: { Authorization: `Bearer ${waiter}` } });
    return r.status === 404 ? true : null;
  }, "el TPV local aplica el pago online y cierra la mesa", 20000);
  check(closed, "el TPV local registró el pago móvil y cerró la mesa");
  const invoices = await api(LOCAL, "GET", "/api/invoices", undefined, waiter);
  check(invoices.length === 2, `facturas en el TPV local: ${invoices.map((i) => i.numSerie).join(", ")}`);
  await api(LOCAL, "POST", "/api/setup/cloud/sync");
  const pm = await waitFor(async () => {
    const list = await api(CLOUD, "GET", "/api/public/payments/" + pay.paymentId);
    return list.registeredByRestaurant ? list : null;
  }, "pago móvil marcado como registrado en la nube", 20000);
  check(pm.status === "SUCCEEDED" && pm.refundCents === 0, `pago móvil en la nube: ${pm.status}, registrado por el TPV`);
  await waitFor(async () => mails.find((m) => m.to.includes("movil@ejemplo.com")), "email del pago móvil", 40000);
  check(true, "email del ticket al cliente que pagó desde el móvil");
  check(printed.length >= 4, `trabajos recibidos por la impresora simulada: ${printed.length}`);
} catch (e) {
  failures++;
  console.error("✘", e.message);
} finally {
  for (const p of procs) {
    try {
      process.kill(-p.pid);
    } catch {}
  }
  aeat.close();
  smtp.close();
  printer.close();
  console.log(failures ? `\nE2E con ${failures} fallo(s)` : "\nE2E OK");
  setTimeout(() => process.exit(failures ? 1 : 0), 1500);
}
