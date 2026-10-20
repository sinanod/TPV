import { useState } from "react";
import type { Settings } from "../types";
import { api, getStoredTenant } from "../lib/api";
import { toast } from "../lib/notify";
import { useResource } from "../lib/useResource";
import { LoadState, PageHeader } from "../components/common";
import { BusinessPanel } from "./BusinessPanel";
import { VerifactuPanel } from "./VerifactuPanel";
import { TicketPanel } from "./TicketPanel";

export function SettingsPage() {
  const settings = useResource(api.settings, ["verifactu:updated", "config:updated"]);
  const printers = useResource(api.printers, ["config:updated"]);
  const submissions = useResource(api.submissions, ["verifactu:updated"]);
  const s = settings.data;

  function saved(next: Settings) {
    settings.setData(next);
    submissions.reload();
  }

  return (
    <>
      <PageHeader title="Ajustes" />
      <LoadState error={settings.error} loading={!s} />
      {s && (
        <>
          <BusinessPanel business={s.business} printers={printers.data?.printers ?? []} onSaved={saved} />
          <TicketPanel
            settings={s}
            printers={printers.data?.printers ?? []}
            restaurantName={getStoredTenant()?.name ?? ""}
            onSaved={saved}
          />
          <VerifactuPanel verifactu={s.verifactu} submissions={submissions.data} onSaved={saved} />
          <OnlinePaymentsPanel settings={s} onSaved={saved} />
          <section className="panel">
            <h2>Tickets por email</h2>
            {s.email.configured ? (
              <p className="small">
                El envío por email está activo: los clientes que dejan su email al pagar reciben el ticket con el QR de
                Hacienda. También puedes reenviarlo desde <a href="#sales">Ventas → Facturas</a>.
              </p>
            ) : (
              <p className="notice">
                El servidor todavía no tiene configurado el correo (SMTP). Los tickets que pidan los clientes por email
                se quedan en cola y se enviarán cuando el proveedor de la plataforma lo configure (los que lleven más de
                7 días en cola ya no se envían).
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}

function OnlinePaymentsPanel({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const op = settings.onlinePayments;
  const [enabled, setEnabled] = useState(op.enabled);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setEnabled(next);
    setBusy(true);
    try {
      const saved = await api.saveOnlinePayments(next);
      setEnabled(saved.onlinePayments.enabled);
      onSaved(saved);
      toast(next ? "Pago desde el móvil activado" : "Pago desde el móvil desactivado");
    } catch (e) {
      setEnabled(!next);
      toast((e as Error).message, "error");
    }
    setBusy(false);
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Pago desde el móvil</h2>
        <span className={`badge ${enabled ? "ok" : ""}`}>{enabled ? "Activado" : "Desactivado"}</span>
      </div>
      <p className="small explain">
        El cliente escanea el código QR de su mesa, ve la cuenta y paga todo o una parte desde su móvil. El TPV lo
        registra automáticamente en la cuenta. Los QR se imprimen desde <a href="#floor">Salón</a>.
      </p>
      {!op.available ? (
        <p className="notice">
          No disponible: el servidor no tiene ninguna pasarela de pago configurada. Pídeselo al proveedor de la
          plataforma.
        </p>
      ) : (
        op.provider === "demo" && (
          <p className="notice danger" role="note">
            <strong>Pasarela de DEMOSTRACIÓN.</strong> Los clientes verán una página de pago de prueba y no se cobra
            nada: el restaurante no recibe dinero. Úsalo solo para probar, nunca con clientes reales.
          </p>
        )
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy || (!op.available && !enabled)}
          onChange={(e) => toggle(e.target.checked)}
        />
        Permitir que los clientes paguen desde el móvil
      </label>
    </section>
  );
}
