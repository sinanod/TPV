import { prisma } from "./db";
import { emitEvent } from "./realtime";
import { PaymentResult } from "./billing";
import { invoiceIssued, orderChanged, tableChanged } from "./cloud/sync";
import { printReceipt, PrintResult } from "./printing/service";

/**
 * Tras registrar un pago: avisa a las pantallas, lo envía a la nube y, si
 * se ha cerrado la cuenta, imprime el ticket. La impresión nunca impide el
 * cobro: si falla, queda como trabajo con error para reintentar.
 */
export async function publishPayment(result: PaymentResult): Promise<PrintResult | null> {
  emitEvent("order:updated", { orderId: result.orderId });
  await orderChanged(result.orderId);
  if (!result.invoiceId) return null;

  const table = await prisma.table.findUniqueOrThrow({ where: { id: result.tableId }, include: { zone: true } });
  emitEvent("table:updated", { table });
  emitEvent("order:closed", { tableId: result.tableId, orderId: result.orderId });
  await tableChanged(result.tableId);
  await invoiceIssued(result.invoiceId);
  return printReceipt(result.invoiceId).catch((e) => {
    console.error("[impresión] ticket", e);
    return null;
  });
}
