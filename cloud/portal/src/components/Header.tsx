import { useState } from "react";
import type { Tenant } from "../types";

export type Section = "live" | "sales" | "catalog" | "floor" | "staff";

export const SECTIONS: { id: Section; label: string }[] = [
  { id: "live", label: "En directo" },
  { id: "sales", label: "Ventas" },
  { id: "catalog", label: "Carta" },
  { id: "floor", label: "Salón" },
  { id: "staff", label: "Personal" },
];

type Props = { tenant: Tenant; section: Section; onNavigate: (s: Section) => void; onLogout: () => void };

export function Header({ tenant, section, onNavigate, onLogout }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <header className="app-header">
      <div className="header-bar">
        <div className="brand">
          <strong>{tenant.name}</strong>
          <span className="muted small">Portal de administración</span>
        </div>
        <button
          className="btn menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="main-nav"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {current.label} ▾
        </button>
        <button className="btn ghost logout" onClick={onLogout}>
          Salir
        </button>
      </div>
      <nav id="main-nav" className={`main-nav${menuOpen ? " open" : ""}`}>
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={s.id === section ? "active" : undefined}
            aria-current={s.id === section ? "page" : undefined}
            onClick={() => {
              onNavigate(s.id);
              setMenuOpen(false);
            }}
          >
            {s.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
