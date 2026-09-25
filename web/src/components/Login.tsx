import { useState } from "react";
import { api, setToken } from "../lib/api";
import { getServerUrl, setServerUrl } from "../lib/config";
import type { User } from "../types";

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [pin, setPin] = useState("");
  const [serverUrl, setServerUrlState] = useState(getServerUrl());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setServerUrl(serverUrl);
    try {
      const { token, user } = await api.login(pin);
      setToken(token);
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>TPV — Panel de control</h1>
        <label>
          Servidor
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrlState(e.target.value)}
            placeholder="http://192.168.1.10:4000"
          />
        </label>
        <label>
          PIN
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading || !pin}>
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
