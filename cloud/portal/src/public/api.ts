export type TableView = {
  restaurant: string;
  table: string;
  onlinePayments: { enabled: boolean; demo: boolean };
  bill: {
    lines: { name: string; qty: number; totalCents: number }[];
    totalCents: number;
    paidCents: number;
    pendingCents: number;
  } | null;
};

export type PaymentView = {
  id: string;
  status: "CREATED" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  amountCents: number;
  restaurant: string;
  table: string;
  tableToken: string;
  email: string | null;
  registeredByRestaurant: boolean;
  refundCents: number;
  receipt: { status: "PENDING" | "SENT" | "FAILED" } | null;
  demo: boolean;
};

export class PublicError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/public${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "omit",
    });
  } catch {
    throw new PublicError(0, "No hay conexión. Comprueba tu internet y vuelve a intentarlo.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fallback = res.status === 400 ? "Revisa los datos" : "Algo ha fallado. Inténtalo de nuevo.";
    throw new PublicError(res.status, (data as { error?: string }).error ?? fallback);
  }
  return data as T;
}

export const publicApi = {
  table: (token: string) => call<TableView>(`/tables/${encodeURIComponent(token)}`),
  pay: (token: string, amountCents: number, email: string) =>
    call<{ paymentId: string; redirectUrl: string }>(`/tables/${encodeURIComponent(token)}/payments`, "POST", {
      amountCents,
      ...(email ? { email } : {}),
    }),
  payment: (id: string) => call<PaymentView>(`/payments/${encodeURIComponent(id)}`),
  demoConfirm: (id: string) => call(`/payments/${encodeURIComponent(id)}/demo/confirm`, "POST"),
  demoCancel: (id: string) => call(`/payments/${encodeURIComponent(id)}/demo/cancel`, "POST"),
};

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
export const euros = (cents: number) => eur.format(cents / 100);
