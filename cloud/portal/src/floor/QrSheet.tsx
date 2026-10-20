import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { TableQr } from "../types";
import { api, getStoredTenant } from "../lib/api";
import { confirmAndRun } from "../lib/notify";
import { useResource } from "../lib/useResource";
import { LoadState } from "../components/common";

export function QrSheet({ onBack }: { onBack: () => void }) {
  const qrs = useResource(api.tableQrs, ["config:updated"]);
  const settings = useResource(api.settings, ["config:updated"]);
  const [images, setImages] = useState<Record<string, string>>({});
  const restaurant = settings.data?.business.tradeName || getStoredTenant()?.name || "";
  const paymentsOff = settings.data && !settings.data.onlinePayments.enabled;

  useEffect(() => {
    let cancelled = false;
    const urls = (qrs.data ?? []).map((q) => q.url);
    Promise.all(
      urls.map((url) =>
        QRCode.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: "M" }).then((img) => [url, img]),
      ),
    ).then((pairs) => !cancelled && setImages(Object.fromEntries(pairs)));
    return () => {
      cancelled = true;
    };
  }, [qrs.data]);

  async function rotate(q: TableQr) {
    const ok = await confirmAndRun(
      `¿Regenerar el código QR de ${q.label}? El QR impreso actual dejará de funcionar y tendrás que imprimir y colocar el nuevo.`,
      () => api.rotateTableQr(q.tableId),
      "Código QR regenerado",
    );
    if (ok) qrs.reload();
  }

  return (
    <>
      <div className="page-header no-print">
        <h1>Códigos QR de las mesas</h1>
        <div className="page-actions">
          <button className="btn ghost" onClick={onBack}>
            Volver al salón
          </button>
          <button className="btn primary" onClick={() => window.print()} disabled={!qrs.data?.length}>
            Imprimir
          </button>
        </div>
      </div>
      <div className="no-print">
        <p className="muted small intro">
          Imprime esta hoja, recorta cada tarjeta y colócala en su mesa. Al escanearla, el cliente ve la cuenta de esa
          mesa y puede pagarla desde el móvil. Si un QR se ha copiado o fotografiado fuera del local, regenéralo.
        </p>
        {paymentsOff && (
          <p className="notice">
            El pago desde el móvil está desactivado: los clientes verán la cuenta, pero se les dirá que la pidan al
            camarero. Puedes activarlo en <a href="#settings">Ajustes</a>.
          </p>
        )}
      </div>
      <LoadState error={qrs.error} loading={!qrs.data} />
      {qrs.data?.length === 0 && <p className="muted panel">No hay mesas. Créalas primero en el salón.</p>}
      <div className="qr-sheet">
        {qrs.data?.map((q) => (
          <article key={q.tableId} className="qr-card" data-testid={`qr-${q.label}`}>
            <p className="qr-restaurant">{restaurant}</p>
            <p className="qr-table">{q.label}</p>
            {images[q.url] ? (
              <img src={images[q.url]} alt={`Código QR de ${q.label}`} className="qr-image" />
            ) : (
              <div className="qr-image placeholder" />
            )}
            <p className="qr-cta">Escanea para ver tu cuenta y pagar</p>
            <button className="btn small ghost no-print" onClick={() => rotate(q)}>
              Regenerar
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
