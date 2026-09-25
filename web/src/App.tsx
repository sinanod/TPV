import { useEffect, useState } from "react";
import { Login } from "./components/Login";
import { FloorPlan } from "./components/FloorPlan";
import { OrderPanel } from "./components/OrderPanel";
import { SummaryBar } from "./components/SummaryBar";
import { api, getStoredUser, getToken, setStoredUser, setToken } from "./lib/api";
import { getSocket, disconnectSocket } from "./lib/socket";
import type { Category, DashboardSummary, Table, User, Zone } from "./types";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);

  async function loadAll() {
    const [zonesRes, categoriesRes, summaryRes] = await Promise.all([
      api.zones(),
      api.categories(),
      api.dashboardSummary(),
    ]);
    setZones(zonesRes);
    setCategories(categoriesRes);
    setSummary(summaryRes);
  }

  useEffect(() => {
    const storedUser = getStoredUser();
    if (!getToken() || !storedUser) return;
    // Sesión previa: intentamos recuperar el estado; si el token caducó, se
    // volverá a pedir login en el primer fallo de loadAll().
    loadAll()
      .then(() => setUser(storedUser))
      .catch(() => {
        setToken(null);
        setStoredUser(null);
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    loadAll();

    const socket = getSocket();
    const refresh = () => loadAll();
    socket.on("table:updated", refresh);
    socket.on("order:updated", refresh);
    socket.on("order:closed", refresh);
    socket.on("order:sent", refresh);
    socket.on("config:updated", refresh);

    return () => {
      socket.off("table:updated", refresh);
      socket.off("order:updated", refresh);
      socket.off("order:closed", refresh);
      socket.off("order:sent", refresh);
      socket.off("config:updated", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function handleLogout() {
    setToken(null);
    setStoredUser(null);
    disconnectSocket();
    setUser(null);
    setSelectedTable(null);
  }

  if (!user) {
    return (
      <Login
        onLogin={(u) => {
          setStoredUser(u);
          setUser(u);
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>TPV — {user.name || "Panel de control"}</h1>
        <button className="link" onClick={handleLogout}>
          Salir
        </button>
      </header>
      <SummaryBar summary={summary} />
      <div className="app-body">
        <FloorPlan zones={zones} onSelectTable={setSelectedTable} selectedTableId={selectedTable?.id} />
        {selectedTable && (
          <OrderPanel
            table={selectedTable}
            categories={categories}
            onClose={() => setSelectedTable(null)}
          />
        )}
      </div>
    </div>
  );
}
