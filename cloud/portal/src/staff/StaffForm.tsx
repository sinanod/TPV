import { useState } from "react";
import type { Role, Staff } from "../types";
import { api } from "../lib/api";
import { ROLE } from "../lib/format";
import { toast } from "../lib/notify";
import { FormModal } from "../components/FormModal";

type Props = { staff: Staff | null; onClose: () => void; onSaved: () => void };

export function StaffForm({ staff, onClose, onSaved }: Props) {
  const [name, setName] = useState(staff?.name ?? "");
  const [pin, setPin] = useState(staff?.pin ?? "");
  const [role, setRole] = useState<Role>(staff?.role ?? "WAITER");
  const [showPin, setShowPin] = useState(!staff);

  async function save() {
    const data = { name, pin, role };
    if (staff) await api.updateStaff(staff.id, data);
    else await api.createStaff(data);
    toast(staff ? "Empleado guardado" : "Empleado creado");
    onSaved();
  }

  return (
    <FormModal title={staff ? "Editar empleado" : "Nuevo empleado"} onSubmit={save} onClose={onClose}>
      <label>
        Nombre
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoFocus />
      </label>
      <label>
        PIN de acceso al TPV
        <span className="input-with-button">
          <input
            type={showPin ? "text" : "password"}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            pattern="\d{4,6}"
            title="Entre 4 y 6 dígitos"
            autoComplete="off"
            required
          />
          <button type="button" className="btn ghost small" onClick={() => setShowPin((s) => !s)}>
            {showPin ? "Ocultar" : "Mostrar"}
          </button>
        </span>
        <span className="muted small">Entre 4 y 6 dígitos. No puede repetirse entre empleados.</span>
      </label>
      <label>
        Rol
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {Object.entries(ROLE).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </FormModal>
  );
}
