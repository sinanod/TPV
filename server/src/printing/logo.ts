import { prisma } from "../db";
import type { PrintDocument, ResolvedBlock, ResolvedDocument } from "./document";
import type { TicketLogoInfo } from "../settings";
import { decodePng, GrayImage } from "./raster";

export interface TicketLogo extends TicketLogoInfo {
  png: Buffer;
  image: GrayImage;
}

let cache: { hash: string; png: Buffer; image: GrayImage } | null = null;

/**
 * Logo del ticket listo para imprimir, o null si el restaurante no tiene o
 * aún no se ha descargado el que toca (entonces el ticket sale sin logo).
 */
export async function loadTicketLogo(info: TicketLogoInfo | null): Promise<TicketLogo | null> {
  if (!info) return null;
  if (cache?.hash !== info.hash) {
    const row = await prisma.ticketLogo.findUnique({ where: { id: 1 } });
    if (!row || row.hash !== info.hash) return null;
    const png = Buffer.from(row.png);
    cache = { hash: row.hash, png, image: decodePng(png) };
  }
  return { ...info, png: cache.png, image: cache.image };
}

/** Carga las imágenes del documento; si un logo ya no está disponible, el ticket sale sin él. */
export async function resolveImages(doc: PrintDocument): Promise<ResolvedDocument> {
  const blocks: ResolvedBlock[] = [];
  for (const block of doc.blocks) {
    if (block.t !== "image") blocks.push(block);
    else {
      const logo = await loadTicketLogo(block.logo);
      if (logo) blocks.push({ t: "image", logo });
    }
  }
  return { blocks };
}
