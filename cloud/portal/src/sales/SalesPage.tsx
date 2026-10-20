import { useState } from "react";
import { api } from "../lib/api";
import { addDays, fromDateInput, presetRange, Preset } from "../lib/dates";
import { money, paymentLabel } from "../lib/format";
import { downloadCsv, ticketsToCsv } from "../lib/csv";
import { useResource } from "../lib/useResource";
import { Kpi, LoadState, PageHeader } from "../components/common";
import { RangePicker } from "./RangePicker";
import { DailyBreakdown } from "./DailyBreakdown";
import { TicketList } from "./TicketList";
import { InvoiceList } from "./InvoiceList";
import { needsRefund, OnlinePayments } from "./OnlinePayments";

type Tab = "tickets" | "invoices" | "payments";

export function SalesPage() {
  const [range, setRange] = useState(() => presetRange("today"));
  const [preset, setPreset] = useState<Preset | null>("today");
  const [tab, setTab] = useState<Tab>("tickets");
  const payments = useResource(api.onlinePayments, ["live:updated"]);
  const refunds = payments.data?.filter(needsRefund).length ?? 0;

  const sales = useResource(
    () => {
      if (!range.from || !range.to) return Promise.reject(new Error("Indica las dos fechas"));
      if (range.from > range.to) return Promise.reject(new Error("La fecha inicial es posterior a la final"));
      return api.sales(fromDateInput(range.from), addDays(fromDateInput(range.to), 1));
    },
    ["live:updated"],
    [range.from, range.to],
  );
  const data = sales.data;
  const multiDay = range.from !== range.to;

  return (
    <>
      <PageHeader title="Ventas">
        <button
          className={`btn${tab === "tickets" ? "" : " hidden"}`}
          disabled={!data?.tickets.length}
          onClick={() => data && downloadCsv(`ventas_${range.from}_${range.to}.csv`, ticketsToCsv(data.tickets))}
        >
          Exportar CSV
        </button>
      </PageHeader>

      <div className="tabs" role="tablist" aria-label="Vista">
        {(
          [
            ["tickets", "Tickets"],
            ["invoices", "Facturas"],
            ["payments", "Pagos móvil"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
            {id === "payments" && refunds > 0 && <span className="tab-alert">{refunds} a devolver</span>}
          </button>
        ))}
      </div>

      {tab !== "payments" && (
        <RangePicker
          range={range}
          preset={preset}
          onPreset={(p) => {
            setPreset(p);
            setRange(presetRange(p));
          }}
          onCustom={(r) => {
            setPreset(null);
            setRange(r);
          }}
        />
      )}

      {tab === "invoices" && <InvoiceList range={range} />}
      {tab === "payments" && (
        <>
          <LoadState error={payments.error} loading={!payments.data} />
          {payments.data && <OnlinePayments payments={payments.data} />}
        </>
      )}

      {tab === "tickets" && <LoadState error={sales.error} loading={!data} />}
      {tab === "tickets" && data && !sales.error && (
        <>
          {data.truncated && (
            <p className="notice">
              Hay demasiados tickets en este rango: solo se muestran los {data.tickets.length} más recientes y los
              totales corresponden a ellos. Elige un rango más corto para ver datos completos.
            </p>
          )}

          <section className="kpi-grid" aria-label="Totales">
            <Kpi label="Ventas" value={money(data.totals.revenue)} />
            <Kpi label="Tickets" value={data.totals.count} />
            <Kpi label="Ticket medio" value={money(data.totals.averageTicket)} />
            {Object.entries(data.totals.byPayment).map(([method, total]) => (
              <Kpi key={method} label={paymentLabel(method)} value={money(total)} />
            ))}
          </section>

          {multiDay && (
            <section className="panel">
              <h2>Por día</h2>
              <DailyBreakdown tickets={data.tickets} />
            </section>
          )}

          <section className="panel">
            <h2>Tickets</h2>
            <TicketList tickets={data.tickets} showDate={multiDay} />
          </section>
        </>
      )}
    </>
  );
}
