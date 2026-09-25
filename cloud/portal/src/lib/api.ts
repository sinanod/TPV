import type { Category, FloorZone, Order, Overview, Product, Sales, Staff, Tenant } from "../types";

const TOKEN_KEY = "tpv_portal_token";
const TENANT_KEY = "tpv_portal_tenant";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredTenant(): Tenant | null {
  const raw = localStorage.getItem(TENANT_KEY);
  return raw && getToken() ? (JSON.parse(raw) as Tenant) : null;
}

export function saveSession(token: string, tenant: Tenant) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TENANT_KEY, JSON.stringify(tenant));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TENANT_KEY);
}

let unauthorizedHandler = () => {};

export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

export function notifyUnauthorized() {
  clearSession();
  unauthorizedHandler();
}

const FIELD_NAMES: Record<string, string> = {
  name: "Nombre",
  pin: "PIN",
  role: "Rol",
  price: "Precio",
  number: "Número",
  capacity: "Comensales",
  sortOrder: "Orden",
  printerTag: "Impresora",
};

type ErrorBody = { error?: string; details?: Record<string, string[] | undefined> };

function errorMessage(status: number, body: ErrorBody) {
  const base = body.error || `Error ${status}`;
  const details = Object.entries(body.details ?? {})
    .filter(([, msgs]) => msgs?.length)
    .map(([field, msgs]) => `${FIELD_NAMES[field] ?? field}: ${msgs!.join(", ")}`);
  return details.length ? `${base} (${details.join("; ")})` : base;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "No se puede conectar con el servidor");
  }

  // Sin token, un 401 es una contraseña incorrecta en el login, no una sesión caducada.
  if (res.status === 401 && token) notifyUnauthorized();
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, errorMessage(res.status, data as ErrorBody));
  return data as T;
}

type CategoryInput = Pick<Category, "name" | "printerTag" | "sortOrder">;
type ProductInput = Omit<Product, "id">;
type ZoneInput = { name: string; sortOrder: number };
type TableInput = { zoneId: string; number: number; capacity: number };
type StaffInput = Omit<Staff, "id">;

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; tenant: Tenant }>("/auth/login", "POST", { username, password }),
  me: () => request<Tenant>("/auth/me"),

  overview: (since: Date) => request<Overview>(`/portal/overview?since=${encodeURIComponent(since.toISOString())}`),
  floor: () => request<FloorZone[]>("/portal/floor"),
  openOrders: () => request<Order[]>("/portal/orders/open"),
  sales: (from: Date, to: Date) =>
    request<Sales>(
      `/portal/sales?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
    ),
  revokeDevice: (id: string) => request<void>(`/portal/devices/${id}`, "DELETE"),

  catalog: () => request<Category[]>("/portal/catalog"),
  createCategory: (data: CategoryInput) => request<Category>("/portal/categories", "POST", data),
  updateCategory: (id: string, data: Partial<CategoryInput>) => request<Category>(`/portal/categories/${id}`, "PATCH", data),
  deleteCategory: (id: string) => request<void>(`/portal/categories/${id}`, "DELETE"),
  createProduct: (data: ProductInput) => request<Product>("/portal/products", "POST", data),
  updateProduct: (id: string, data: Partial<ProductInput>) => request<Product>(`/portal/products/${id}`, "PATCH", data),
  deleteProduct: (id: string) => request<void>(`/portal/products/${id}`, "DELETE"),

  createZone: (data: ZoneInput) => request("/portal/zones", "POST", data),
  updateZone: (id: string, data: Partial<ZoneInput>) => request(`/portal/zones/${id}`, "PATCH", data),
  deleteZone: (id: string) => request<void>(`/portal/zones/${id}`, "DELETE"),
  createTable: (data: TableInput) => request("/portal/tables", "POST", data),
  updateTable: (id: string, data: Partial<TableInput>) => request(`/portal/tables/${id}`, "PATCH", data),
  deleteTable: (id: string) => request<void>(`/portal/tables/${id}`, "DELETE"),

  staff: () => request<Staff[]>("/portal/staff"),
  createStaff: (data: StaffInput) => request<Staff>("/portal/staff", "POST", data),
  updateStaff: (id: string, data: Partial<StaffInput>) => request<Staff>(`/portal/staff/${id}`, "PATCH", data),
  deleteStaff: (id: string) => request<void>(`/portal/staff/${id}`, "DELETE"),
};
