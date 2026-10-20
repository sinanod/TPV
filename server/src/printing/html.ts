import QRCode from "qrcode";
import { Block, PrintDocument } from "./document";
import { columnsFor, row, wrap } from "./escpos";

// Para impresoras instaladas en el sistema (USB) que imprime la app de
// escritorio con su driver: mismo documento, como HTML monoespaciado.

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function blockHtml(block: Block, columns: number): Promise<string> {
  switch (block.t) {
    case "text":
    case "row": {
      const large = block.large ?? false;
      const width = large ? Math.floor(columns / 2) : columns;
      const texts = block.t === "text" ? wrap(block.text, width) : row(block.left, block.right, width);
      const align = block.t === "text" ? (block.align ?? "left") : "left";
      const style = [
        `text-align:${align}`,
        block.bold ? "font-weight:bold" : "",
        large ? "font-size:2em;line-height:1.1" : "",
      ]
        .filter(Boolean)
        .join(";");
      return `<pre style="${style}">${escapeHtml(texts.join("\n"))}</pre>`;
    }
    case "rule":
      return `<pre>${"-".repeat(columns)}</pre>`;
    case "qr": {
      const svg = await QRCode.toString(block.data, { type: "svg", errorCorrectionLevel: "M", margin: 0 });
      return `<div class="qr">${svg}</div>`;
    }
    case "feed":
      return "<br>".repeat(block.lines ?? 1);
  }
}

export async function toHtml(doc: PrintDocument, widthMm: number): Promise<string> {
  const columns = columnsFor(widthMm);
  const body = (await Promise.all(doc.blocks.map((b) => blockHtml(b, columns)))).join("\n");
  // 1ch = ancho de un carácter monoespaciado: ajusta las columnas al papel.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${widthMm}mm auto; margin: 0; }
body { margin: 0; padding: 2mm; width: ${widthMm - 4}mm; font-family: "Courier New", monospace;
       font-size: calc((${widthMm - 4}mm) / ${columns} / 0.6); color: #000; }
pre { margin: 0; white-space: pre-wrap; font: inherit; }
.qr { text-align: center; margin: 2mm 0; }
.qr svg { width: 35mm; height: 35mm; }
</style></head><body>
${body}
</body></html>`;
}
