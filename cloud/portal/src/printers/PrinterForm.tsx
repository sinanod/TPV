import { useState } from "react";
import type { PaperWidth, Printer, PrintersResponse, PrinterType } from "../types";
import { api } from "../lib/api";
import { toast } from "../lib/notify";
import { FormModal } from "../components/FormModal";

type Props = {
  printer: Printer | null;
  systemPrinters: PrintersResponse["systemPrinters"];
  onClose: () => void;
  onSaved: () => void;
};

export function PrinterForm({ printer, systemPrinters, onClose, onSaved }: Props) {
  const [name, setName] = useState(printer?.name ?? "");
  const [type, setType] = useState<PrinterType>(printer?.type ?? "NETWORK");
  const [ip, setIp] = useState(printer?.type === "NETWORK" ? printer.address : "");
  const [port, setPort] = useState(String(printer?.type === "NETWORK" ? printer.port : 9100));
  const [systemName, setSystemName] = useState(printer?.type === "SYSTEM" ? printer.address : "");
  const [width, setWidth] = useState<PaperWidth>(printer?.width ?? 80);
  const suggestions = [...new Set(systemPrinters.flatMap((d) => d.printers))].sort();

  async function save() {
    const data =
      type === "NETWORK"
        ? { name, type, address: ip.trim(), port: Number(port), width }
        : { name, type, address: systemName.trim(), port: 9100, width };
    if (printer) await api.updatePrinter(printer.id, data);
    else await api.createPrinter(data);
    toast(printer ? "Impresora guardada" : "Impresora creada");
    onSaved();
  }

  return (
    <FormModal title={printer ? "Editar impresora" : "Nueva impresora"} onSubmit={save} onClose={onClose}>
      <label>
        Nombre
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          placeholder="Cocina, Barra, Tickets…"
          autoFocus
        />
      </label>
      <fieldset className="segmented">
        <legend>Tipo de conexión</legend>
        <label className={type === "NETWORK" ? "active" : undefined}>
          <input type="radio" name="type" checked={type === "NETWORK"} onChange={() => setType("NETWORK")} />
          Red (IP)
        </label>
        <label className={type === "SYSTEM" ? "active" : undefined}>
          <input type="radio" name="type" checked={type === "SYSTEM"} onChange={() => setType("SYSTEM")} />
          USB en el PC
        </label>
      </fieldset>
      {type === "NETWORK" ? (
        <>
          <p className="muted small">
            Impresora térmica conectada al router o a la red WiFi del local, con su propia IP.
          </p>
          <div className="field-row">
            <label className="grow">
              Dirección IP
              <input
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                required
                maxLength={200}
                placeholder="192.168.1.200"
                inputMode="decimal"
                autoCapitalize="none"
              />
            </label>
            <label className="port">
              Puerto
              <input
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                required
              />
            </label>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            Impresora instalada en el ordenador del TPV (normalmente por USB). Escribe su nombre exacto, tal y como
            aparece en el sistema.
          </p>
          <label>
            Nombre en el sistema
            <input
              value={systemName}
              onChange={(e) => setSystemName(e.target.value)}
              list="system-printers"
              required
              maxLength={200}
              placeholder="EPSON TM-T20III Receipt"
              autoCapitalize="none"
            />
            <datalist id="system-printers">
              {suggestions.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          {suggestions.length ? (
            <div className="muted small">
              Impresoras que han informado los TPV:
              <ul className="plain-list">
                {systemPrinters
                  .filter((d) => d.printers.length)
                  .map((d) => (
                    <li key={d.device}>
                      <strong>{d.device}:</strong>{" "}
                      {d.printers.map((n, i) => (
                        <span key={n}>
                          {i > 0 && ", "}
                          <button type="button" className="link-button" onClick={() => setSystemName(n)}>
                            {n}
                          </button>
                        </span>
                      ))}
                    </li>
                  ))}
              </ul>
            </div>
          ) : (
            <p className="muted small">
              Ningún TPV vinculado ha informado aún de sus impresoras. Aparecerán aquí cuando el TPV esté encendido y
              conectado.
            </p>
          )}
        </>
      )}
      <label>
        Ancho del papel
        <select value={width} onChange={(e) => setWidth(Number(e.target.value) as PaperWidth)}>
          <option value={80}>80 mm (el más habitual)</option>
          <option value={58}>58 mm</option>
        </select>
      </label>
    </FormModal>
  );
}
