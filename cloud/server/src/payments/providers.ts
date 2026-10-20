import { config } from "../config";

// Pasarela para el pago desde el móvil. Para conectar una real (Redsys,
// Stripe...) hay que implementar esta interfaz y una ruta de notificación
// (webhook) que marque el pago como SUCCEEDED y avise a los TPV con
// markOnlinePaymentSucceeded().

export interface CheckoutInput {
  paymentId: string;
  amountCents: number;
  description: string;
  /** Adónde vuelve el cliente al terminar */
  returnUrl: string;
}

export interface CheckoutSession {
  /** URL a la que se redirige al cliente para pagar */
  redirectUrl: string;
  providerRef: string | null;
}

export interface PaymentProvider {
  name: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
}

/** Simula el cobro con una página propia. No mueve dinero: solo para pruebas. */
const demoProvider: PaymentProvider = {
  name: "demo",
  async createCheckout({ paymentId }) {
    return { redirectUrl: `/pago-demo/${paymentId}`, providerRef: null };
  },
};

export function getPaymentProvider(): PaymentProvider | null {
  if (config.paymentProvider === "demo") return demoProvider;
  return null;
}
