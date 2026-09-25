export type Tenant = { id: string; name: string; username: string };

export type TableStatus = "FREE" | "OCCUPIED" | "BILL_REQUESTED";
export type OrderStatus = "OPEN" | "SENT" | "SERVED" | "PAID" | "CANCELLED";
export type PrinterTag = "KITCHEN" | "BAR" | "NONE";
export type Role = "ADMIN" | "WAITER" | "KITCHEN";

export type Device = {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: string | null;
  createdAt: string;
};

export type Overview = {
  tenant: { id: string; name: string };
  devices: Device[];
  tables: { free: number; occupied: number; billRequested: number };
  openOrders: { count: number; total: number };
  today: { revenue: number; count: number; averageTicket: number };
};

export type FloorTable = {
  id: string;
  zoneId: string;
  number: number;
  capacity: number;
  status: TableStatus;
  statusAt: string | null;
  openOrder: { id: string; total: number; waiterName: string | null; openedAt: string; status: OrderStatus } | null;
};

export type FloorZone = { id: string; name: string; sortOrder: number; tables: FloorTable[] };

export type OrderLine = {
  id: string;
  productName: string;
  qty: number;
  unitPrice: number;
  note: string | null;
  status: string;
};

export type Order = {
  id: string;
  tableId: string | null;
  tableLabel: string;
  waiterName: string | null;
  status: OrderStatus;
  paymentMethod: string | null;
  total: number;
  openedAt: string;
  closedAt: string | null;
  lines: OrderLine[];
};

export type Sales = {
  totals: { revenue: number; count: number; averageTicket: number; byPayment: Record<string, number> };
  truncated: boolean;
  tickets: Order[];
};

export type Product = {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  available: boolean;
  sortOrder: number;
};

export type Category = { id: string; name: string; printerTag: PrinterTag; sortOrder: number; products: Product[] };

export type Staff = { id: string; name: string; pin: string; role: Role };
