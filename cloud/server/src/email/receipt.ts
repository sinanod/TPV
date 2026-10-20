import QRCode from "qrcode";

export interface ReceiptData {
  businessName: string;
  legalName: string;
  nif: string;
  address: string;
  footer: string;
  numSerie: string;
  issuedAt: Date;
  tableLabel: string;
  lines: { name: string; qty: number; totalCents: number }[];
  breakdown: { rate: number; baseCents: number; quotaCents: number }[];
  totalCents: number;
  payments: { method: string; amountCents: number }[];
  qrUrl: string | null;
}

const PAYMENT_LABEL: Record<string, string> = { CASH: "Efectivo", CARD: "Tarjeta", ONLINE: "Pago móvil" };

function euros(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const when = (d: Date) =>
  d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" });

export async function renderReceiptEmail(r: ReceiptData) {
  const subject = `Tu ticket de ${r.businessName} (${r.numSerie})`;
  const qrPng = r.qrUrl ? await QRCode.toBuffer(r.qrUrl, { errorCorrectionLevel: "M", margin: 2, width: 280 }) : null;

  const row = (left: string, right: string, strong = false) =>
    `<tr><td style="padding:2px 0;${strong ? "font-weight:bold;" : ""}">${esc(left)}</td>` +
    `<td style="padding:2px 0;text-align:right;white-space:nowrap;${strong ? "font-weight:bold;" : ""}">${esc(right)}</td></tr>`;

  // El QR tributario va arriba, con «QR tributario:» encima y VERI*FACTU debajo,
  // igual que en el ticket impreso.
  const qrBlock = qrPng
    ? `<p style="margin:0 0 4px;text-align:center">QR tributario:</p>
       <p style="margin:0;text-align:center"><img src="cid:qr-tributario" width="140" height="140" alt="QR tributario"></p>
       <p style="margin:4px 0 16px;text-align:center;font-weight:bold">VERI*FACTU</p>`
    : "";

  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#111">
<div style="max-width:420px;margin:24px auto;background:#fff;border-radius:8px;padding:24px">
${qrBlock}
<h1 style="font-size:20px;margin:0;text-align:center">${esc(r.businessName)}</h1>
<p style="margin:4px 0 0;text-align:center;font-size:13px;color:#555">${esc(r.legalName)} · NIF ${esc(r.nif)}${r.address ? `<br>${esc(r.address)}` : ""}</p>
<hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
<p style="margin:0;font-weight:bold">Factura simplificada ${esc(r.numSerie)}</p>
<p style="margin:2px 0 0;font-size:13px;color:#555">${esc(when(r.issuedAt))} · ${esc(r.tableLabel)}</p>
<table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:14px">
${r.lines.map((l) => row(`${l.qty} × ${l.name}`, euros(l.totalCents))).join("")}
<tr><td colspan="2"><hr style="border:none;border-top:1px solid #ddd;margin:8px 0"></td></tr>
${row("Total", euros(r.totalCents), true)}
${r.breakdown.map((b) => row(`IVA ${b.rate}% sobre ${euros(b.baseCents)}`, euros(b.quotaCents))).join("")}
<tr><td colspan="2"><hr style="border:none;border-top:1px solid #ddd;margin:8px 0"></td></tr>
${r.payments.map((p) => row(PAYMENT_LABEL[p.method] ?? p.method, euros(p.amountCents))).join("")}
</table>
${r.footer ? `<p style="margin:16px 0 0;text-align:center;font-size:13px">${esc(r.footer)}</p>` : ""}
</div></body></html>`;

  const text = [
    r.businessName,
    `${r.legalName} · NIF ${r.nif}`,
    r.address,
    "",
    `Factura simplificada ${r.numSerie}`,
    `${when(r.issuedAt)} · ${r.tableLabel}`,
    "",
    ...r.lines.map((l) => `${l.qty} x ${l.name}  ${euros(l.totalCents)}`),
    "",
    `TOTAL ${euros(r.totalCents)}`,
    ...r.breakdown.map((b) => `IVA ${b.rate}% sobre ${euros(b.baseCents)}: ${euros(b.quotaCents)}`),
    "",
    ...r.payments.map((p) => `${PAYMENT_LABEL[p.method] ?? p.method}: ${euros(p.amountCents)}`),
    ...(r.qrUrl ? ["", "QR tributario (VERI*FACTU):", r.qrUrl] : []),
    "",
    r.footer,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  return {
    subject,
    html,
    text,
    attachments: qrPng ? [{ filename: "qr-tributario.png", content: qrPng, cid: "qr-tributario" }] : [],
  };
}
