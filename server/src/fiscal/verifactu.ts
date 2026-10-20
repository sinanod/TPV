import crypto from "crypto";

// Registro de facturación de alta VERI*FACTU (Orden HAC/1177/2024).
// Referencias: especificaciones de huella v0.1.2 y de QR v0.5.0 de la AEAT,
// esquema SuministroInformacion.xsd v1.0 (copia en specs/aeat/).

export const SF_NAMESPACE =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd";

export type AeatEnvironment = "TEST" | "PRODUCTION";

const QR_BASE: Record<AeatEnvironment, string> = {
  TEST: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR",
  PRODUCTION: "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR",
};

/** Importe en céntimos → "123.45" (formato de los campos numéricos del XML). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Fecha de expedición en hora local: DD-MM-AAAA */
export function formatInvoiceDate(d: Date): string {
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** Fecha, hora y huso horario de generación en hora local: 2024-01-01T19:20:30+01:00 */
export function formatGenerationTimestamp(d: Date): string {
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function sha256Upper(input: string) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex").toUpperCase();
}

export interface AltaHashFields {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: string;
  TipoFactura: string;
  CuotaTotal: string;
  ImporteTotal: string;
  /** Huella del registro anterior; vacía en el primer registro del sistema */
  Huella: string;
  FechaHoraHusoGenRegistro: string;
}

/** Huella de un registro de alta: campos en orden fijo, `campo=valor&...`, SHA-256, hex en mayúsculas. */
export function altaHash(f: AltaHashFields): string {
  const order: (keyof AltaHashFields)[] = [
    "IDEmisorFactura",
    "NumSerieFactura",
    "FechaExpedicionFactura",
    "TipoFactura",
    "CuotaTotal",
    "ImporteTotal",
    "Huella",
    "FechaHoraHusoGenRegistro",
  ];
  return sha256Upper(order.map((k) => `${k}=${f[k].trim()}`).join("&"));
}

export interface TaxLine {
  /** Importe con IVA incluido, en céntimos */
  grossCents: number;
  /** Tipo de IVA en %, p. ej. 10 */
  taxRate: number;
}

export interface TaxBreakdownItem {
  rate: number;
  baseCents: number;
  quotaCents: number;
}

/** Desglose por tipo de IVA a partir de precios con IVA incluido. Base + cuota = total exacto en cada tipo. */
export function taxBreakdown(lines: TaxLine[]): TaxBreakdownItem[] {
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.taxRate, (byRate.get(l.taxRate) ?? 0) + l.grossCents);
  return [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, gross]) => {
      const baseCents = Math.round(gross / (1 + rate / 100));
      return { rate, baseCents, quotaCents: gross - baseCents };
    });
}

/** URL del QR tributario (cotejo de la factura en la sede de la AEAT). */
export function qrUrl(env: AeatEnvironment, nif: string, numSerie: string, issuedAt: Date, totalCents: number) {
  const params = [
    `nif=${encodeURIComponent(nif)}`,
    `numserie=${encodeURIComponent(numSerie)}`,
    `fecha=${formatInvoiceDate(issuedAt)}`,
    `importe=${formatCents(totalCents)}`,
  ].join("&");
  return `${QR_BASE[env]}?${params}`;
}

function esc(value: string) {
  return value
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface SifInfo {
  producerName: string;
  producerNif: string;
  systemName: string;
  /** 2 caracteres, lo asigna el productor */
  systemId: string;
  version: string;
  /** Identifica esta instalación del sistema */
  installationNumber: string;
}

export interface PreviousRecord {
  nif: string;
  numSerie: string;
  /** DD-MM-AAAA */
  issueDate: string;
  hash: string;
}

export interface AltaInput {
  issuerNif: string;
  issuerName: string;
  numSerie: string;
  issuedAt: Date;
  generatedAt: Date;
  description: string;
  breakdown: TaxBreakdownItem[];
  previous: PreviousRecord | null;
  sif: SifInfo;
}

export interface AltaRecord {
  xml: string;
  hash: string;
  issueDate: string;
  generationTimestamp: string;
  totalCents: number;
  taxCents: number;
}

/**
 * Registro de facturación de alta de una factura simplificada (F2).
 * El XML es el fragmento <sf:RegistroAlta> con su propio namespace: la nube
 * lo inserta tal cual en el envío a la AEAT, sin regenerarlo (la normativa
 * exige que el registro remitido sea exactamente el generado).
 */
export function buildRegistroAlta(input: AltaInput): AltaRecord {
  const taxCents = input.breakdown.reduce((s, b) => s + b.quotaCents, 0);
  const totalCents = input.breakdown.reduce((s, b) => s + b.baseCents + b.quotaCents, 0);
  const issueDate = formatInvoiceDate(input.issuedAt);
  const generationTimestamp = formatGenerationTimestamp(input.generatedAt);

  const hash = altaHash({
    IDEmisorFactura: input.issuerNif,
    NumSerieFactura: input.numSerie,
    FechaExpedicionFactura: issueDate,
    TipoFactura: "F2",
    CuotaTotal: formatCents(taxCents),
    ImporteTotal: formatCents(totalCents),
    Huella: input.previous?.hash ?? "",
    FechaHoraHusoGenRegistro: generationTimestamp,
  });

  const detalle = input.breakdown
    .map(
      (b) =>
        "<sf:DetalleDesglose>" +
        "<sf:Impuesto>01</sf:Impuesto>" +
        "<sf:ClaveRegimen>01</sf:ClaveRegimen>" +
        "<sf:CalificacionOperacion>S1</sf:CalificacionOperacion>" +
        `<sf:TipoImpositivo>${b.rate.toFixed(2)}</sf:TipoImpositivo>` +
        `<sf:BaseImponibleOimporteNoSujeto>${formatCents(b.baseCents)}</sf:BaseImponibleOimporteNoSujeto>` +
        `<sf:CuotaRepercutida>${formatCents(b.quotaCents)}</sf:CuotaRepercutida>` +
        "</sf:DetalleDesglose>",
    )
    .join("");

  const encadenamiento = input.previous
    ? "<sf:RegistroAnterior>" +
      `<sf:IDEmisorFactura>${esc(input.previous.nif)}</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>${esc(input.previous.numSerie)}</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>${input.previous.issueDate}</sf:FechaExpedicionFactura>` +
      `<sf:Huella>${input.previous.hash}</sf:Huella>` +
      "</sf:RegistroAnterior>"
    : "<sf:PrimerRegistro>S</sf:PrimerRegistro>";

  const s = input.sif;
  const xml =
    `<sf:RegistroAlta xmlns:sf="${SF_NAMESPACE}">` +
    "<sf:IDVersion>1.0</sf:IDVersion>" +
    "<sf:IDFactura>" +
    `<sf:IDEmisorFactura>${esc(input.issuerNif)}</sf:IDEmisorFactura>` +
    `<sf:NumSerieFactura>${esc(input.numSerie)}</sf:NumSerieFactura>` +
    `<sf:FechaExpedicionFactura>${issueDate}</sf:FechaExpedicionFactura>` +
    "</sf:IDFactura>" +
    `<sf:NombreRazonEmisor>${esc(input.issuerName)}</sf:NombreRazonEmisor>` +
    "<sf:TipoFactura>F2</sf:TipoFactura>" +
    `<sf:DescripcionOperacion>${esc(input.description)}</sf:DescripcionOperacion>` +
    `<sf:Desglose>${detalle}</sf:Desglose>` +
    `<sf:CuotaTotal>${formatCents(taxCents)}</sf:CuotaTotal>` +
    `<sf:ImporteTotal>${formatCents(totalCents)}</sf:ImporteTotal>` +
    `<sf:Encadenamiento>${encadenamiento}</sf:Encadenamiento>` +
    "<sf:SistemaInformatico>" +
    `<sf:NombreRazon>${esc(s.producerName)}</sf:NombreRazon>` +
    `<sf:NIF>${esc(s.producerNif)}</sf:NIF>` +
    `<sf:NombreSistemaInformatico>${esc(s.systemName)}</sf:NombreSistemaInformatico>` +
    `<sf:IdSistemaInformatico>${esc(s.systemId)}</sf:IdSistemaInformatico>` +
    `<sf:Version>${esc(s.version)}</sf:Version>` +
    `<sf:NumeroInstalacion>${esc(s.installationNumber)}</sf:NumeroInstalacion>` +
    // Este sistema solo funciona en modalidad VERI*FACTU; cada instalación
    // factura para un único restaurante, aunque el software sirve a muchos.
    "<sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu>" +
    "<sf:TipoUsoPosibleMultiOT>S</sf:TipoUsoPosibleMultiOT>" +
    "<sf:IndicadorMultiplesOT>N</sf:IndicadorMultiplesOT>" +
    "</sf:SistemaInformatico>" +
    `<sf:FechaHoraHusoGenRegistro>${generationTimestamp}</sf:FechaHoraHusoGenRegistro>` +
    "<sf:TipoHuella>01</sf:TipoHuella>" +
    `<sf:Huella>${hash}</sf:Huella>` +
    "</sf:RegistroAlta>";

  return { xml, hash, issueDate, generationTimestamp, totalCents, taxCents };
}

/** Las facturas simplificadas en hostelería están limitadas a 3.000 € (art. 4.2 RD 1619/2012). */
export const SIMPLIFIED_INVOICE_LIMIT_CENTS = 300_000;
