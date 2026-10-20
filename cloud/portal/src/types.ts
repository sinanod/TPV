export type Tenant = { id: string; name: string; username: string };

export type TableStatus = "FREE" | "OCCUPIED" | "BILL_REQUESTED";
export type OrderStatus = "OPEN" | "SENT" | "SERVED" | "PAID" | "CANCELLED";
export type Role = "ADMIN" | "WAITER" | "KITCHEN";
export type TaxRate = 0 | 4 | 5 | 10 | 21;
export type PrinterType = "NETWORK" | "SYSTEM";
export type PaperWidth = 58 | 80;
export type AeatStatus = "PENDING" | "CORRECT" | "ACCEPTED_WITH_ERRORS" | "REJECTED" | "NOT_APPLICABLE";
export type AeatEnvironment = "TEST" | "PRODUCTION";
export type CertificateKind = "PERSONAL" | "SELLO";

export type Device = {
  id: string;
  name: string;
  invoiceSeries: string;
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

export type Payment = {
  method: string;
  amountCents: number;
  tenderedCents: number | null;
  refundCents: number;
  onlinePaymentId: string | null;
  createdAt: string;
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
  invoiceNumber: string | null;
  lines: OrderLine[];
  payments?: Payment[];
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
  taxRate: TaxRate;
  available: boolean;
  sortOrder: number;
};

export type Category = { id: string; name: string; printerId: string | null; sortOrder: number; products: Product[] };

export type Printer = {
  id: string;
  name: string;
  type: PrinterType;
  address: string;
  port: number;
  width: PaperWidth;
};

export type PrintersResponse = { printers: Printer[]; systemPrinters: { device: string; printers: string[] }[] };

export type Staff = { id: string; name: string; pin: string; role: Role };

export type Business = {
  tradeName: string;
  legalName: string;
  nif: string;
  address: string;
  receiptPrinterId: string | null;
};

export type LogoStyle = "DITHER" | "THRESHOLD";

export type TicketDesign = {
  showTradeName: boolean;
  headerText: string;
  footer: string;
  showTable: boolean;
  showWaiter: boolean;
  /** % del ancho útil del papel */
  logoSize: number;
  logoStyle: LogoStyle;
};

export type TicketSettings = TicketDesign & {
  logo: { hash: string; width: number; height: number; dataUrl: string } | null;
};

export type TestPrintResult = { deviceName: string; ok: boolean; printerName?: string; error?: string };

export type Settings = {
  business: Business;
  ticket: TicketSettings;
  verifactu: {
    enabled: boolean;
    environment: AeatEnvironment;
    endDate: string | null;
    firstSentAt: string | null;
    certificateKind: CertificateKind;
    certificate: { subject: string | null; notAfter: string | null } | null;
    missing: string[];
    lastError: string | null;
    nextSendAt: string | null;
    pending: number;
    rejected: number;
  };
  onlinePayments: { enabled: boolean; available: boolean; provider: string | null };
  email: { configured: boolean };
  message?: string | null;
};

export type InvoiceEmail = { to: string; status: "PENDING" | "SENT" | "FAILED"; lastError: string | null };

export type Invoice = {
  id: string;
  numSerie: string;
  issuedAt: string;
  totalCents: number;
  taxCents: number;
  tableLabel: string;
  waiterName: string | null;
  lines: { name: string; qty: number; unitPrice: number; taxRate: number; totalCents: number }[];
  payments: Payment[];
  qrUrl: string | null;
  environment: AeatEnvironment | null;
  aeatStatus: AeatStatus;
  aeatErrorCode: string | null;
  aeatError: string | null;
  aeatSentAt: string | null;
  aeatCsv: string | null;
  emails: InvoiceEmail[];
};

export type Submission = {
  id: string;
  environment: AeatEnvironment;
  sentAt: string;
  status: string;
  csv: string | null;
  waitSeconds: number | null;
  records: number;
  error: string | null;
};

export type OnlinePayment = {
  id: string;
  tableLabel: string;
  amountCents: number;
  email: string | null;
  paidAt: string | null;
  applyResult: "APPLIED" | "REFUND_REQUIRED" | "ORDER_NOT_FOUND" | null;
  refundCents: number;
};

export type TableQr = { tableId: string; label: string; url: string };
