import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { AeatEnvironment } from "./fiscal/verifactu";

type Db = Prisma.TransactionClient | typeof prisma;

export interface BusinessInfo {
  /** Nombre comercial (cabecera del ticket) */
  name: string;
  /** Razón social del obligado a facturar */
  legalName: string;
  nif: string;
  address: string;
  ticketFooter: string;
}

export interface TicketLogoInfo {
  hash: string;
  width: number;
  height: number;
  /** Ancho impreso en % del ancho útil del papel */
  sizePercent: number;
  /** DITHER: tramado (fotos, degradados) · THRESHOLD: blanco y negro (logos planos) */
  style: "DITHER" | "THRESHOLD";
}

/** Lo que el restaurante puede ajustar del ticket (lo legal no es configurable). */
export interface TicketDesign {
  /** Se puede ocultar si el logo ya lleva el nombre */
  showTradeName: boolean;
  /** Líneas extra bajo los datos fiscales: teléfono, web… */
  headerText: string;
  footer: string;
  showTable: boolean;
  showWaiter: boolean;
  logo: TicketLogoInfo | null;
}

export const DEFAULT_TICKET: TicketDesign = {
  showTradeName: true,
  headerText: "",
  footer: "",
  showTable: true,
  showWaiter: true,
  logo: null,
};

export interface SifProducer {
  producerName: string;
  producerNif: string;
  systemName: string;
  systemId: string;
  version: string;
}

export interface Settings {
  /** Serie de facturas de este TPV ("L" en modo autónomo, "T1", "T2"... vinculado) */
  invoiceSeries: string;
  /** Identifica esta instalación en los registros VERI*FACTU */
  installationNumber: string;
  receiptPrinterId: number | null;
  business: BusinessInfo | null;
  ticket: TicketDesign;
  verifactu: {
    enabled: boolean;
    environment: AeatEnvironment;
    /** AAAA-MM-DD: último día de uso de VERI*FACTU si se ha renunciado */
    endDate: string | null;
  };
  sif: SifProducer | null;
}

export const DEFAULT_SETTINGS: Settings = {
  invoiceSeries: "L",
  installationNumber: "local",
  receiptPrinterId: null,
  business: null,
  ticket: DEFAULT_TICKET,
  verifactu: { enabled: false, environment: "TEST", endDate: null },
  sif: null,
};

export async function getSettings(db: Db = prisma): Promise<Settings> {
  const row = await db.localSettings.findUnique({ where: { id: 1 } });
  if (!row) return DEFAULT_SETTINGS;
  const saved = JSON.parse(row.json) as Partial<Settings>;
  // Ajustes guardados antes de que existiera el diseño del ticket: el pie venía con los datos fiscales
  const ticket = saved.ticket ?? { ...DEFAULT_TICKET, footer: saved.business?.ticketFooter ?? "" };
  return { ...DEFAULT_SETTINGS, ...saved, ticket };
}

export async function saveSettings(db: Db, settings: Settings) {
  const json = JSON.stringify(settings);
  await db.localSettings.upsert({ where: { id: 1 }, create: { id: 1, json }, update: { json } });
}

function localIsoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** VERI*FACTU está activo hoy (activado y sin haber pasado la fecha de fin comunicada). */
export function verifactuActive(settings: Settings, now = new Date()) {
  const v = settings.verifactu;
  return v.enabled && (!v.endDate || localIsoDate(now) <= v.endDate);
}
