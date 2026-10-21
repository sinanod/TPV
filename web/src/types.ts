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
  /** Unidades ya pagadas eligiendo artículos */
  paidQty: number;
}

export type PaymentMethod = "CASH" | "CARD" | "ONLINE";

export interface Payment {
  id: number;
  items?: { orderLineId: number; qty: number }[];
  method: PaymentMethod;
  amount: number;
  tendered: number | null;
  email: string | null;
  refundAmount: number;
  createdAt: string;
}

export interface InvoiceRef {
  id: number;
  uuid: string;
  numSerie: string;
}

export interface Order {
  id: number;
  status: OrderStatus;
  tableId: number;
  waiterId: number;
  lines: OrderLine[];
  payments: Payment[];
  total: number;
  paid: number;
  pending: number;
  invoice: (InvoiceRef & { qrUrl: string | null }) | null;
  table?: Table;
  waiter?: User;
}

export interface PrintResult {
  jobId: number;
  printerName: string;
  ok: boolean;
  error: string | null;
}

export interface PaymentResponse {
  order: Order;
  change: number;
  invoice: InvoiceRef | null;
  receiptPrint: PrintResult | null;
}

export interface FailedPrintJob {
  id: number;
  kind: string;
  title: string;
  printerName: string | null;
  error: string | null;
  attempts: number;
  updatedAt: string;
}

export interface InvoiceListItem {
  id: number;
  uuid: string;
  numSerie: string;
  issuedAt: string;
  total: number;
  tableLabel: string;
  verifactu: boolean;
  payments: { method: PaymentMethod; amount: number; email: string | null }[];
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
