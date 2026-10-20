import { useEffect, useRef, useState } from "react";
import type { Business, TicketDesign } from "../types";
import { columnsFor, loadImage, renderThermal } from "../lib/thermal";

// Vista previa del ticket del cliente con la misma maqueta que imprime el TPV
// (server/src/printing/document.ts): texto monoespaciado a 48 columnas en
// papel de 80 mm (32 en 58 mm) y el logo ya pasado a puntos negros.

type Line = { text: string; align?: "left" | "center"; bold?: boolean; large?: boolean } | { rule: true } | { gap: true };

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

const row = (left: string, right: string, width: number) =>
  `${left}${" ".repeat(Math.max(width - left.length - right.length, 1))}${right}`;

const euros = (cents: number) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")} €`;

type Props = {
  design: TicketDesign;
  logoUrl: string | null;
  business: Business;
  restaurantName: string;
  paperMm: number;
  verifactu: boolean;
};

export function TicketPreview({ design, logoUrl, business, restaurantName, paperMm, verifactu }: Props) {
  const cols = columnsFor(paperMm);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [logoWidthPct, setLogoWidthPct] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!logoUrl || !canvasRef.current) return;
    loadImage(logoUrl).then((img) => {
      if (cancelled || !canvasRef.current) return;
      const { width, dots } = renderThermal(canvasRef.current, img, paperMm, design.logoSize, design.logoStyle);
      setLogoWidthPct((width / dots) * 100);
    });
    return () => {
      cancelled = true;
    };
  }, [logoUrl, paperMm, design.logoSize, design.logoStyle]);

  const name = business.tradeName || restaurantName;
  const showName = design.showTradeName || !logoUrl;
  const legal = business.legalName || "RAZÓN SOCIAL";
  const lines: Line[] = [];
  const center = (text: string, extra: Partial<{ bold: boolean; large: boolean }> = {}) =>
    wrap(text, extra.large ? cols / 2 : cols).forEach((t) => lines.push({ text: t, align: "center", ...extra }));

  if (showName) center(name, { bold: true, large: true });
  if (legal !== name || !showName) center(legal);
  center(`NIF ${business.nif || "—"}`);
  if (business.address) center(business.address);
  design.headerText.split("\n").filter(Boolean).forEach((l) => center(l));
  lines.push({ rule: true });
  lines.push({ text: "FACTURA SIMPLIFICADA", bold: true });
  lines.push({ text: row("Nº T1-2026-000042", "21/10/2026 13:05", cols) });
  const who = [design.showTable && "Terraza · Mesa 4", design.showWaiter && "Ana"].filter(Boolean).join(" · ");
  if (who) lines.push({ text: who });
  lines.push({ rule: true });
  lines.push({ text: row("2 x Caña", euros(440), cols) });
  lines.push({ text: row("1 x Patatas bravas", euros(650), cols) });
  lines.push({ text: row("1 x Tarta de queso", euros(450), cols) });
  lines.push({ rule: true });
  lines.push({ text: row("TOTAL", euros(1540), cols / 2), bold: true, large: true });
  lines.push({ text: row("IVA 10% s/ 14,00 €", euros(140), cols) });
  lines.push({ rule: true });
  lines.push({ text: row("Efectivo", euros(1540), cols) });
  lines.push({ text: row("Cambio", euros(460), cols) });
  if (design.footer) {
    lines.push({ gap: true });
    design.footer.split("\n").filter(Boolean).forEach((l) => center(l));
  }

  return (
    <figure className="ticket-preview" aria-label="Vista previa del ticket">
      <div className="ticket-paper" style={{ ["--cols" as string]: cols }}>
        {verifactu && (
          <div className="ticket-qr">
            <div>QR tributario:</div>
            <div className="ticket-qr-box" aria-hidden="true" />
            <div className="strong">VERI*FACTU</div>
          </div>
        )}
        {logoUrl && (
          <div className="ticket-logo">
            <canvas ref={canvasRef} style={{ width: `${logoWidthPct}%` }} />
          </div>
        )}
        {lines.map((l, i) =>
          "rule" in l ? (
            <div key={i} className="ticket-line">
              {"-".repeat(cols)}
            </div>
          ) : "gap" in l ? (
            <div key={i} className="ticket-line">
              {" "}
            </div>
          ) : (
            <div
              key={i}
              className={`ticket-line${l.bold ? " strong" : ""}${l.large ? " large" : ""}`}
              style={{ textAlign: l.align ?? "left" }}
            >
              {l.text || " "}
            </div>
          ),
        )}
      </div>
      <figcaption className="hint">
        Papel de {paperMm} mm · el logo se ve como lo imprimirá la térmica (solo puntos negros)
      </figcaption>
    </figure>
  );
}
