export type Role = "ADMIN" | "WAITER" | "KITCHEN";
export type TableStatus = "FREE" | "OCCUPIED" | "BILL_REQUESTED";
export type OrderStatus = "OPEN" | "SENT" | "SERVED" | "PAID" | "CANCELLED";
export type LineStatus = "PENDING" | "SENT";

export interface User {
  id: number;
  name: string;
  role: Role;
}

export interface Zone {
  id: number;
  name: string;
  tables: Table[];
}

export interface Table {
  id: number;
  number: number;
  capacity: number;
  status: TableStatus;
  zoneId: number;
  zone?: { id: number; name: string };
}

export interface Product {
  id: number;
  name: string;
  price: number;
  available: boolean;
  categoryId: number;
}

export interface Category {
  id: number;
  name: string;
  printerTag: "KITCHEN" | "BAR" | "NONE";
  products: Product[];
}

export interface OrderLine {
  id: number;
  productId: number;
  qty: number;
  unitPrice: number;
  note: string | null;
  status: LineStatus;
  product: Product;
}

export interface Order {
  id: number;
  status: OrderStatus;
  tableId: number;
  waiterId: number;
  lines: OrderLine[];
  total: number;
  table?: Table;
  waiter?: User;
}

export type CloudStatus =
  | { linked: false }
  | {
      linked: true;
      cloudUrl: string;
      tenantName: string;
      deviceName: string;
      connected: boolean;
      configVersion: number;
      lastConfigAt: string | null;
      lastSyncAt: string | null;
      lastError: string | null;
      pendingEvents: number;
    };

export interface DashboardSummary {
  ordersToday: number;
  revenueToday: number;
  averageTicket: number;
  tables: { free: number; occupied: number; billRequested: number };
}
