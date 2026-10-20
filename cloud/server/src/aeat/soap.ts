import { XMLParser } from "fast-xml-parser";

// Remisión voluntaria VERI*FACTU (servicio SistemaFacturacion, esquema v1.0).

export const NS_LR =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd";
export const NS_SF =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd";

export type AeatEnvironment = "TEST" | "PRODUCTION";
export type CertificateKind = "PERSONAL" | "SELLO";

// Del WSDL oficial (specs/aeat/SistemaFacturacion.wsdl)
const ENDPOINTS: Record<AeatEnvironment, Record<CertificateKind, string>> = {
  TEST: {
    PERSONAL: "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
    SELLO: "https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
  },
  PRODUCTION: {
    PERSONAL: "https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
    SELLO: "https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
  },
};

export function endpointFor(env: AeatEnvironment, kind: CertificateKind) {
  return ENDPOINTS[env][kind];
}

/** Máximo de registros por envío según el diseño de registro */
export const MAX_RECORDS_PER_SUBMISSION = 1000;
/** Tiempo de espera inicial entre envíos (art. 16.2 de la orden) */
export const DEFAULT_WAIT_SECONDS = 60;

function esc(s: string) {
  return s.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface SubmissionInput {
  issuerName: string;
  issuerNif: string;
  /** DD-MM-AAAA: último día de uso de VERI*FACTU si se ha renunciado */
  endDate: string | null;
  /** Registros <sf:RegistroAlta> tal cual los generó el TPV */
  records: string[];
}

/** Mensaje RegFactuSistemaFacturacion (sin sobre SOAP). Los registros se insertan sin modificar. */
export function buildRegFactu(input: SubmissionInput) {
  const remision = input.endDate
    ? `<sum1:RemisionVoluntaria><sum1:FechaFinVeriFactu>${input.endDate}</sum1:FechaFinVeriFactu></sum1:RemisionVoluntaria>`
    : "";
  return (
    `<sum:RegFactuSistemaFacturacion xmlns:sum="${NS_LR}" xmlns:sum1="${NS_SF}">` +
    "<sum:Cabecera>" +
    "<sum1:ObligadoEmision>" +
    `<sum1:NombreRazon>${esc(input.issuerName)}</sum1:NombreRazon>` +
    `<sum1:NIF>${esc(input.issuerNif)}</sum1:NIF>` +
    "</sum1:ObligadoEmision>" +
    remision +
    "</sum:Cabecera>" +
    input.records.map((r) => `<sum:RegistroFactura>${r}</sum:RegistroFactura>`).join("") +
    "</sum:RegFactuSistemaFacturacion>"
  );
}

export function buildEnvelope(input: SubmissionInput) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
    "<soapenv:Header/>" +
    `<soapenv:Body>${buildRegFactu(input)}</soapenv:Body>` +
    "</soapenv:Envelope>"
  );
}

export type RecordStatus = "CORRECT" | "ACCEPTED_WITH_ERRORS" | "REJECTED";

export interface LineResult {
  numSerie: string;
  status: RecordStatus;
  errorCode: string | null;
  error: string | null;
}

export interface SubmissionResponse {
  /** Correcto | ParcialmenteCorrecto | Incorrecto */
  status: string;
  csv: string | null;
  waitSeconds: number;
  lines: LineResult[];
}

export class SoapFaultError extends Error {}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === "RespuestaLinea",
});

const STATUS: Record<string, RecordStatus> = {
  Correcto: "CORRECT",
  AceptadoConErrores: "ACCEPTED_WITH_ERRORS",
  Incorrecto: "REJECTED",
};
const DUPLICATE_STATUS: Record<string, RecordStatus> = {
  Correcta: "CORRECT",
  AceptadaConErrores: "ACCEPTED_WITH_ERRORS",
};

type Node = Record<string, unknown>;
const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v).trim());

export function parseResponse(xml: string): SubmissionResponse {
  const doc = parser.parse(xml) as Node;
  const body = (doc.Envelope as Node | undefined)?.Body as Node | undefined;
  if (!body) throw new SoapFaultError("Respuesta de la AEAT sin cuerpo SOAP");
  if (body.Fault) {
    const fault = body.Fault as Node;
    throw new SoapFaultError(`La AEAT rechazó el envío: ${str(fault.faultstring) ?? "error SOAP"}`);
  }
  const r = body.RespuestaRegFactuSistemaFacturacion as Node | undefined;
  if (!r) throw new SoapFaultError("Respuesta de la AEAT no reconocida");

  const lines = ((r.RespuestaLinea as Node[] | undefined) ?? []).map((l): LineResult => {
    const id = l.IDFactura as Node;
    const duplicate = l.RegistroDuplicado as Node | undefined;
    // Un registro que la AEAT ya tenía (p. ej. reenvío tras un corte) no es un
    // error si el que consta es correcto.
    const duplicateStatus = duplicate ? DUPLICATE_STATUS[str(duplicate.EstadoRegistroDuplicado) ?? ""] : undefined;
    return {
      numSerie: str(id?.NumSerieFactura) ?? "",
      status: duplicateStatus ?? STATUS[str(l.EstadoRegistro) ?? ""] ?? "REJECTED",
      errorCode: duplicateStatus ? null : str(l.CodigoErrorRegistro),
      error: duplicateStatus ? null : str(l.DescripcionErrorRegistro),
    };
  });

  const wait = Number(str(r.TiempoEsperaEnvio));
  return {
    status: str(r.EstadoEnvio) ?? "Incorrecto",
    csv: str(r.CSV),
    waitSeconds: Number.isFinite(wait) && wait > 0 ? wait : DEFAULT_WAIT_SECONDS,
    lines,
  };
}

/** AAAA-MM-DD → DD-MM-AAAA */
export function toAeatDate(isoDate: string) {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
}
