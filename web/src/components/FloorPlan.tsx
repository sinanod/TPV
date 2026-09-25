import type { Table, Zone } from "../types";

const STATUS_LABEL: Record<Table["status"], string> = {
  FREE: "Libre",
  OCCUPIED: "Ocupada",
  BILL_REQUESTED: "Cuenta pedida",
};

export function FloorPlan({
  zones,
  onSelectTable,
  selectedTableId,
}: {
  zones: Zone[];
  onSelectTable: (table: Table) => void;
  selectedTableId?: number;
}) {
  return (
    <div className="floor-plan">
      {zones.map((zone) => (
        <div key={zone.id} className="zone">
          <h3>{zone.name}</h3>
          <div className="table-grid">
            {zone.tables.map((table) => (
              <button
                key={table.id}
                className={`table-tile status-${table.status.toLowerCase()} ${
                  table.id === selectedTableId ? "selected" : ""
                }`}
                onClick={() => onSelectTable(table)}
              >
                <span className="table-number">Mesa {table.number}</span>
                <span className="table-status">{STATUS_LABEL[table.status]}</span>
                <span className="table-capacity">{table.capacity} pax</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
