package com.tpv.comandas.data.model

data class User(
    val id: Int,
    val name: String,
    val role: String,
)

data class LoginRequest(val pin: String)
data class LoginResponse(val token: String, val user: User)

data class Zone(
    val id: Int,
    val name: String,
    val tables: List<TableInfo>,
)

data class TableInfo(
    val id: Int,
    val number: Int,
    val capacity: Int,
    val status: String,
    val zoneId: Int,
)

data class Product(
    val id: Int,
    val name: String,
    val price: Double,
    val available: Boolean,
    val categoryId: Int,
)

// Familia de productos: su impresora decide dónde sale cada plato al enviar
data class Category(
    val id: Int,
    val name: String,
    val printerId: Int?,
    val products: List<Product>,
)

data class OrderLine(
    val id: Int,
    val productId: Int,
    val qty: Int,
    val unitPrice: Double,
    val note: String?,
    val status: String,
    val product: Product,
    /** Unidades ya pagadas eligiendo artículos */
    val paidQty: Int = 0,
)

data class Payment(
    val id: Int,
    /** CASH, CARD u ONLINE (pagado por el cliente desde el QR de la mesa) */
    val method: String,
    val amount: Double,
    val tendered: Double?,
    val email: String?,
    val refundAmount: Double,
    /** Artículos que pagó, si se cobró eligiendo artículos */
    val items: List<PaidItem>? = null,
)

data class PaidItem(val orderLineId: Int, val qty: Int)

data class InvoiceRef(val id: Int, val uuid: String, val numSerie: String)

data class Order(
    val id: Int,
    val status: String,
    val tableId: Int,
    val waiterId: Int,
    val lines: List<OrderLine>,
    val payments: List<Payment>,
    val total: Double,
    val paid: Double,
    val pending: Double,
    val invoice: InvoiceRef?,
)

data class PrintResult(val jobId: Int, val printerName: String, val ok: Boolean, val error: String?)

/** De la respuesta de POST /orders/:id/send solo nos interesa cómo fue cada impresión */
data class SendOrderResponse(val prints: List<PrintResult>)

data class OpenTableResponse(
    val table: TableInfo,
    val order: Order,
)

data class LineInput(val productId: Int, val qty: Int, val note: String? = null)
data class AddLinesRequest(val lines: List<LineInput>)
data class CloseRequest(val paymentMethod: String)

data class PaymentRequest(
    val method: String,
    /** null = todo lo pendiente */
    val amount: Double?,
    /** Solo efectivo, para calcular el cambio */
    val tendered: Double?,
    /** Si se indica, la nube le envía el ticket por correo al cerrar la cuenta */
    val email: String?,
    /** Cobro por artículos: el servidor calcula el importe (amount se ignora) */
    val items: List<ItemRequest>? = null,
)

data class ItemRequest(val lineId: Int, val qty: Int)

data class PaymentResponse(
    val order: Order,
    val change: Double,
    /** No es null cuando este pago completa la cuenta */
    val invoice: InvoiceRef?,
    val receiptPrint: PrintResult?,
)

data class TableCounts(val free: Int, val occupied: Int, val billRequested: Int)
data class DashboardSummary(
    val ordersToday: Int,
    val revenueToday: Double,
    val averageTicket: Double,
    val tables: TableCounts,
)

data class ApiErrorBody(val error: String?)
