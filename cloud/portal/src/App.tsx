import { useEffect, useState } from "react";
import { api, clearSession, getStoredTenant, onUnauthorized } from "./lib/api";
import { disconnectRealtime } from "./lib/socket";
import type { Tenant } from "./types";
import { Login } from "./components/Login";
import { Header, Section, SECTIONS } from "./components/Header";
import { Toaster } from "./components/Toaster";
import { LivePage } from "./live/LivePage";
import { SalesPage } from "./sales/SalesPage";
import { CatalogPage } from "./catalog/CatalogPage";
import { FloorPage } from "./floor/FloorPage";
import { StaffPage } from "./staff/StaffPage";

function sectionFromHash(): Section {
  const id = window.location.hash.slice(1);
  return SECTIONS.some((s) => s.id === id) ? (id as Section) : "live";
}

const PAGES: Record<Section, () => JSX.Element> = {
  live: LivePage,
  sales: SalesPage,
  catalog: CatalogPage,
  floor: FloorPage,
  staff: StaffPage,
};

export default function App() {
  const [tenant, setTenant] = useState<Tenant | null>(getStoredTenant);
  const [section, setSection] = useState<Section>(sectionFromHash);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    onUnauthorized(() => {
      disconnectRealtime();
      setTenant(null);
      setNotice("La sesión ha caducado o la cuenta está desactivada. Vuelve a entrar.");
    });
    if (getStoredTenant()) api.me().then(setTenant, () => {});
  }, []);

  useEffect(() => {
    const onHash = () => setSection(sectionFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function logout() {
    clearSession();
    disconnectRealtime();
    setNotice(null);
    setTenant(null);
  }

  if (!tenant) {
    return (
      <Login
        notice={notice}
        onLogin={(t) => {
          setNotice(null);
          setTenant(t);
        }}
      />
    );
  }

  const Page = PAGES[section];
  return (
    <>
      <Header tenant={tenant} section={section} onNavigate={setSection} onLogout={logout} />
      <main className="app-main">
        <Page />
      </main>
      <Toaster />
    </>
  );
}
