import { getServerUrl } from "./config";
import type { Category, DashboardSummary, Order, User, Zone } from "../types";

const TOKEN_KEY = "tpv_token";
const USER_KEY = "tpv_user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as User) : null;
}

export function setStoredUser(user: User | null) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${getServerUrl()}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body.error || `Error ${res.status}`);
  }
  return body as T;
}

export const api = {
  login: (pin: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),
  zones: () => request<Zone[]>("/zones"),
  categories: () => request<Category[]>("/categories"),
  openTable: (tableId: number) =>
    request<{ table: Zone["tables"][number]; order: Order }>(`/tables/${tableId}/open`, {
      method: "POST",
    }),
  requestBill: (tableId: number) =>
    request(`/tables/${tableId}/request-bill`, { method: "POST" }),
  orderForTable: (tableId: number) => request<Order>(`/orders/table/${tableId}`),
  addLines: (orderId: number, lines: { productId: number; qty: number; note?: string }[]) =>
    request<Order>(`/orders/${orderId}/lines`, {
      method: "POST",
      body: JSON.stringify({ lines }),
    }),
  deleteLine: (orderId: number, lineId: number) =>
    request<Order>(`/orders/${orderId}/lines/${lineId}`, { method: "DELETE" }),
  sendOrder: (orderId: number) => request<Order>(`/orders/${orderId}/send`, { method: "POST" }),
  closeOrder: (orderId: number, paymentMethod: "CASH" | "CARD") =>
    request(`/orders/${orderId}/close`, {
      method: "POST",
      body: JSON.stringify({ paymentMethod }),
    }),
  dashboardSummary: () => request<DashboardSummary>("/dashboard/summary"),
};
