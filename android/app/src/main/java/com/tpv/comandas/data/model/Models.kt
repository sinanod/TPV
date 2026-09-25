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

data class Category(
    val id: Int,
    val name: String,
    val printerTag: String,
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
)

data class Order(
    val id: Int,
    val status: String,
    val tableId: Int,
    val waiterId: Int,
    val lines: List<OrderLine>,
    val total: Double,
)

data class OpenTableResponse(
    val table: TableInfo,
    val order: Order,
)

data class LineInput(val productId: Int, val qty: Int, val note: String? = null)
data class AddLinesRequest(val lines: List<LineInput>)
data class CloseRequest(val paymentMethod: String)

data class TableCounts(val free: Int, val occupied: Int, val billRequested: Int)
data class DashboardSummary(
    val ordersToday: Int,
    val revenueToday: Double,
    val averageTicket: Double,
    val tables: TableCounts,
)

data class ApiErrorBody(val error: String?)
