import { Block, PrintDocument } from "./document";

const ESC = 0x1b;
const GS = 0x1d;

// Página de códigos PC858 (= PC850 con € en 0xD5): cubre el castellano y el
// resto de lenguas de España. En impresoras Epson y compatibles: ESC t 19.
const CODE_PAGE_PC858 = 19;
const PC858: Record<string, number> = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ä: 0x84, à: 0x85, å: 0x86, ç: 0x87, ê: 0x88, ë: 0x89,
  è: 0x8a, ï: 0x8b, î: 0x8c, ì: 0x8d, Ä: 0x8e, Å: 0x8f, É: 0x90, æ: 0x91, Æ: 0x92, ô: 0x93,
  ö: 0x94, ò: 0x95, û: 0x96, ù: 0x97, ÿ: 0x98, Ö: 0x99, Ü: 0x9a, ø: 0x9b, "£": 0x9c, Ø: 0x9d,
  "×": 0x9e, á: 0xa0, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ª: 0xa6, º: 0xa7, "¿": 0xa8,
  "¡": 0xad, "«": 0xae, "»": 0xaf, Á: 0xb5, Â: 0xb6, À: 0xb7, ã: 0xc6, Ã: 0xc7, Ê: 0xd2, Ë: 0xd3,
  È: 0xd4, "€": 0xd5, Í: 0xd6, Î: 0xd7, Ï: 0xd8, Ì: 0xde, Ó: 0xe0, ß: 0xe1, Ô: 0xe2, Ò: 0xe3,
  õ: 0xe4, Õ: 0xe5, Ú: 0xe9, Û: 0xea, Ù: 0xeb, "·": 0xfa, "°": 0xf8,
};

export function encodePc858(text: string): number[] {
  const bytes: number[] = [];
  for (const ch of text.normalize("NFC")) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code < 0x7f) bytes.push(code);
    else bytes.push(PC858[ch] ?? 0x3f);
  }
  return bytes;
}

export function columnsFor(widthMm: number) {
  return widthMm >= 80 ? 48 : 32;
}

/** Parte un texto en líneas de como mucho `width` caracteres, por palabras. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (word.length > width) {
        if (line) lines.push(line);
        for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
        line = lines.pop() ?? "";
      } else if (!line) {
        line = word;
      } else if (line.length + 1 + word.length <= width) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Fila con texto a la izquierda e importe alineado a la derecha. */
export function row(left: string, right: string, width: number): string[] {
  const room = width - right.length - 1;
  const leftLines = wrap(left, Math.max(room, 1));
  const last = leftLines.pop() ?? "";
  return [...leftLines, `${last}${" ".repeat(Math.max(width - last.length - right.length, 1))}${right}`];
}

function qrCommands(data: string): number[] {
  const payload = encodePc858(data);
  const len = payload.length + 3;
  return [
    // Modelo 2
    GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,
    // Módulo de 6 puntos ≈ 35 mm en una impresora de 203 ppp (30–40 mm exigidos)
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06,
    // Corrección de errores nivel M (obligatorio)
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31,
    GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...payload,
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30,
  ];
}

const ALIGN = { left: 0, center: 1, right: 2 } as const;

function blockBytes(block: Block, columns: number): number[] {
  const out: number[] = [];
  const lines = (texts: string[]) => texts.forEach((l) => out.push(...encodePc858(l), 0x0a));

  switch (block.t) {
    case "text":
    case "row": {
      const large = block.large ?? false;
      const width = large ? Math.floor(columns / 2) : columns;
      out.push(ESC, 0x61, ALIGN[block.t === "text" ? (block.align ?? "left") : "left"]);
      out.push(ESC, 0x45, block.bold ? 1 : 0);
      out.push(GS, 0x21, large ? 0x11 : 0x00);
      lines(block.t === "text" ? wrap(block.text, width) : row(block.left, block.right, width));
      out.push(GS, 0x21, 0x00, ESC, 0x45, 0, ESC, 0x61, 0);
      break;
    }
    case "rule":
      lines(["-".repeat(columns)]);
      break;
    case "qr":
      out.push(ESC, 0x61, 1, ...qrCommands(block.data), 0x0a, ESC, 0x61, 0);
      break;
    case "feed":
      out.push(ESC, 0x64, block.lines ?? 1);
      break;
  }
  return out;
}

/** Documento → bytes ESC/POS, terminando con avance y corte parcial. */
export function toEscPos(doc: PrintDocument, widthMm: number): Buffer {
  const columns = columnsFor(widthMm);
  const bytes = [ESC, 0x40, ESC, 0x74, CODE_PAGE_PC858];
  for (const block of doc.blocks) bytes.push(...blockBytes(block, columns));
  bytes.push(GS, 0x56, 0x42, 0x03);
  return Buffer.from(bytes);
}
