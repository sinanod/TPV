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
  verifactu: { enabled: false, environment: "TEST", endDate: null },
  sif: null,
};

export async function getSettings(db: Db = prisma): Promise<Settings> {
  const row = await db.localSettings.findUnique({ where: { id: 1 } });
  return row ? { ...DEFAULT_SETTINGS, ...(JSON.parse(row.json) as Partial<Settings>) } : DEFAULT_SETTINGS;
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
