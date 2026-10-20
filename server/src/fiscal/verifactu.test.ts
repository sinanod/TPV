import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  altaHash,
  buildRegistroAlta,
  formatCents,
  formatGenerationTimestamp,
  qrUrl,
  SifInfo,
  taxBreakdown,
} from "./verifactu";

process.env.TZ = "Europe/Madrid";

const SPECS = path.join(__dirname, "..", "..", "..", "specs", "aeat");
const hasXmllint = spawnSync("xmllint", ["--version"]).status === 0;

const sif: SifInfo = {
  producerName: "Software TPV SL",
  producerNif: "B12345674",
  systemName: "TPV Restaurantes",
  systemId: "TR",
  version: "1.0.0",
  installationNumber: "0f8b3c1e-1111-4a2b-9c3d-000000000001",
};

describe("huella (vectores del documento de la AEAT v0.1.2)", () => {
  it("caso 1: primer registro de alta", () => {
    expect(
      altaHash({
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345678/G33",
        FechaExpedicionFactura: "01-01-2024",
        TipoFactura: "F1",
        CuotaTotal: "12.35",
        ImporteTotal: "123.45",
        Huella: "",
        FechaHoraHusoGenRegistro: "2024-01-01T19:20:30+01:00",
      }),
    ).toBe("3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60");
  });

  it("caso 2: registro de alta encadenado con el anterior", () => {
    expect(
      altaHash({
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345679/G34",
        FechaExpedicionFactura: "01-01-2024",
        TipoFactura: "F1",
        CuotaTotal: "12.35",
        ImporteTotal: "123.45",
        Huella: "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60",
        FechaHoraHusoGenRegistro: "2024-01-01T19:20:35+01:00",
      }),
    ).toBe("F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97");
  });

  it("ignora espacios al inicio y al final de los valores", () => {
    expect(
      altaHash({
        IDEmisorFactura: " 89890001K ",
        NumSerieFactura: "  12345678/G33",
        FechaExpedicionFactura: "01-01-2024",
        TipoFactura: "F1",
        CuotaTotal: "12.35",
        ImporteTotal: "123.45",
        Huella: "",
        FechaHoraHusoGenRegistro: "2024-01-01T19:20:30+01:00 ",
      }),
    ).toBe("3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60");
  });
});

describe("formatos", () => {
  it("importes con dos decimales y signo", () => {
    expect(formatCents(12345)).toBe("123.45");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(-250)).toBe("-2.50");
  });

  it("marca temporal con el huso horario local (invierno y verano)", () => {
    expect(formatGenerationTimestamp(new Date("2024-01-01T18:20:30Z"))).toBe("2024-01-01T19:20:30+01:00");
    expect(formatGenerationTimestamp(new Date("2024-07-01T18:20:30Z"))).toBe("2024-07-01T20:20:30+02:00");
  });

  it("URL del QR con el número de serie codificado (ejemplo del documento de QR)", () => {
    expect(qrUrl("TEST", "89890001K", "12345678&G33", new Date(2024, 0, 1, 12), 24140)).toBe(
      "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=12345678%26G33&fecha=01-01-2024&importe=241.40",
    );
    expect(qrUrl("PRODUCTION", "89890001K", "A-1", new Date(2024, 0, 1, 12), 100)).toMatch(
      /^https:\/\/www2\.agenciatributaria\.gob\.es\/wlpl\/TIKE-CONT\/ValidarQR\?/,
    );
  });
});

describe("desglose de IVA", () => {
  it("base + cuota suman exactamente el total con IVA de cada tipo", () => {
    const b = taxBreakdown([
      { grossCents: 220, taxRate: 10 },
      { grossCents: 650, taxRate: 10 },
      { grossCents: 333, taxRate: 21 },
    ]);
    expect(b).toEqual([
      { rate: 10, baseCents: 791, quotaCents: 79 },
      { rate: 21, baseCents: 275, quotaCents: 58 },
    ]);
    expect(b.reduce((s, x) => s + x.baseCents + x.quotaCents, 0)).toBe(1203);
  });
});

describe("registro de alta F2", () => {
  const first = buildRegistroAlta({
    issuerNif: "B76543214",
    issuerName: "Bar Pepe & Hijos <SL>",
    numSerie: "T1-2026-000001",
    issuedAt: new Date("2026-10-20T10:00:00Z"),
    generatedAt: new Date("2026-10-20T10:00:01Z"),
    description: "Servicio de restauración",
    breakdown: taxBreakdown([
      { grossCents: 1100, taxRate: 10 },
      { grossCents: 605, taxRate: 21 },
    ]),
    previous: null,
    sif,
  });

  it("la huella del XML es la de sus propios campos", () => {
    expect(first.totalCents).toBe(1705);
    expect(first.hash).toBe(
      altaHash({
        IDEmisorFactura: "B76543214",
        NumSerieFactura: "T1-2026-000001",
        FechaExpedicionFactura: "20-10-2026",
        TipoFactura: "F2",
        CuotaTotal: formatCents(first.taxCents),
        ImporteTotal: "17.05",
        Huella: "",
        FechaHoraHusoGenRegistro: "2026-10-20T12:00:01+02:00",
      }),
    );
    expect(first.xml).toContain("<sf:PrimerRegistro>S</sf:PrimerRegistro>");
    expect(first.xml).toContain("Bar Pepe &amp; Hijos &lt;SL&gt;");
  });

  it("el siguiente registro se encadena con la huella del anterior", () => {
    const second = buildRegistroAlta({
      issuerNif: "B76543214",
      issuerName: "Bar Pepe",
      numSerie: "T1-2026-000002",
      issuedAt: new Date("2026-10-20T10:05:00Z"),
      generatedAt: new Date("2026-10-20T10:05:00Z"),
      description: "Servicio de restauración",
      breakdown: taxBreakdown([{ grossCents: 220, taxRate: 10 }]),
      previous: { nif: "B76543214", numSerie: "T1-2026-000001", issueDate: first.issueDate, hash: first.hash },
      sif,
    });
    expect(second.xml).toContain(`<sf:Huella>${first.hash}</sf:Huella></sf:RegistroAnterior>`);
    expect(second.hash).not.toBe(first.hash);
  });

  it.skipIf(!hasXmllint)("valida contra el esquema oficial SuministroLR.xsd", () => {
    const doc =
      '<sfLR:RegFactuSistemaFacturacion xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd"' +
      ' xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">' +
      "<sfLR:Cabecera><sf:ObligadoEmision><sf:NombreRazon>Bar Pepe</sf:NombreRazon><sf:NIF>B76543214</sf:NIF></sf:ObligadoEmision></sfLR:Cabecera>" +
      `<sfLR:RegistroFactura>${first.xml}</sfLR:RegistroFactura>` +
      "</sfLR:RegFactuSistemaFacturacion>";
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vf-")), "envio.xml");
    fs.writeFileSync(file, doc);
    const out = execFileSync("xmllint", ["--nonet", "--noout", "--schema", path.join(SPECS, "SuministroLR.xsd"), file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(out).toBe("");
  });
});
