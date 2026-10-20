package com.tpv.comandas.ui.order

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tpv.comandas.AppContainer
import com.tpv.comandas.data.model.AddLinesRequest
import com.tpv.comandas.data.model.Category
import com.tpv.comandas.data.model.CloseRequest
import com.tpv.comandas.data.model.LineInput
import com.tpv.comandas.data.model.Order
import com.tpv.comandas.data.model.PaymentRequest
import com.tpv.comandas.data.network.SocketManager
import com.tpv.comandas.data.network.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import retrofit2.HttpException

data class OrderUiState(
    val categories: List<Category> = emptyList(),
    val order: Order? = null,
    val selectedCategoryId: Int? = null,
    val loading: Boolean = true,
    val busy: Boolean = false,
    val error: String? = null,
    /** Aviso informativo (cobro parcial, cambio a devolver...) */
    val notice: String? = null,
    val showPayment: Boolean = false,
    /** Mensaje con el que se vuelve al mapa de mesas al cerrar la cuenta */
    val closedMessage: String? = null,
    val closed: Boolean = false,
)

class OrderViewModel(private val container: AppContainer, private val tableId: Int) : ViewModel() {
    private val _state = MutableStateFlow(OrderUiState())
    val state: StateFlow<OrderUiState> = _state.asStateFlow()

    private var socketManager: SocketManager? = null

    init {
        load(openIfMissing = true)
        listenForUpdates()
    }

    /**
     * Solo al entrar se abre la mesa si no tiene comanda. En las recargas por
     * tiempo real, que no haya comanda significa que se cerró en otro sitio
     * (otro camarero, el TPV o un pago desde el móvil del cliente).
     */
    private fun load(openIfMissing: Boolean) {
        viewModelScope.launch {
            try {
                val service = container.apiClient.service()
                val categories = service.categories()
                var order = fetchOrder()
                if (order == null) {
                    if (!openIfMissing) {
                        _state.value = _state.value.copy(closed = true, closedMessage = "La cuenta de esta mesa se ha cerrado")
                        return@launch
                    }
                    service.openTable(tableId)
                    order = fetchOrder()
                }
                _state.value = _state.value.copy(
                    categories = categories,
                    order = order,
                    selectedCategoryId = _state.value.selectedCategoryId ?: categories.firstOrNull()?.id,
                    loading = false,
                    error = null,
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.toUserMessage())
            }
        }
    }

    private suspend fun fetchOrder(): Order? = try {
        container.apiClient.service().orderForTable(tableId)
    } catch (e: HttpException) {
        if (e.code() == 404) null else throw e
    }

    private fun listenForUpdates() {
        val manager = container.newSocketManager()
        socketManager = manager
        viewModelScope.launch {
            manager.events().collect { if (!_state.value.closed) load(openIfMissing = false) }
        }
    }

    fun selectCategory(categoryId: Int) {
        _state.value = _state.value.copy(selectedCategoryId = categoryId)
    }

    fun addProduct(productId: Int) {
        val order = _state.value.order ?: return
        runBusy {
            val updated = container.apiClient.service()
                .addLines(order.id, AddLinesRequest(listOf(LineInput(productId, 1))))
            _state.value = _state.value.copy(order = updated)
        }
    }

    fun removeLine(lineId: Int) {
        val order = _state.value.order ?: return
        runBusy {
            val updated = container.apiClient.service().deleteLine(order.id, lineId)
            _state.value = _state.value.copy(order = updated)
        }
    }

    fun sendToKitchen() {
        val order = _state.value.order ?: return
        runBusy {
            val service = container.apiClient.service()
            val result = service.sendOrder(order.id)
            // Un plato que no se imprime no sale de cocina: hay que avisar al camarero
            val failed = result.prints.filter { !it.ok }
            _state.value = _state.value.copy(
                order = fetchOrder() ?: order,
                error = failed.takeIf { it.isNotEmpty() }?.joinToString("\n") {
                    "No se imprimió en ${it.printerName}: ${it.error ?: "error"}. Reinténtalo desde el TPV."
                },
                notice = if (failed.isEmpty() && result.prints.isNotEmpty()) {
                    "Enviado a ${result.prints.joinToString { it.printerName }}"
                } else {
                    null
                },
            )
        }
    }

    fun openPayment() {
        _state.value = _state.value.copy(showPayment = true, error = null, notice = null)
    }

    fun dismissPayment() {
        _state.value = _state.value.copy(showPayment = false)
    }

    /** Cobro total o parcial; devuelve la respuesta para que el diálogo recalcule la siguiente parte */
    fun pay(request: PaymentRequest, onResult: (Order) -> Unit) {
        val order = _state.value.order ?: return
        runBusy {
            val result = container.apiClient.service().addPayment(order.id, request)
            val change = if (result.change > 0) " · Cambio: ${euros(result.change)}" else ""
            if (result.invoice != null) {
                val printIssue = result.receiptPrint?.takeIf { !it.ok }?.let { " · El ticket no se imprimió (${it.error})" } ?: ""
                _state.value = _state.value.copy(
                    order = result.order,
                    showPayment = false,
                    closed = true,
                    closedMessage = "Cobrada · Factura ${result.invoice.numSerie}$change$printIssue",
                )
            } else {
                _state.value = _state.value.copy(
                    order = result.order,
                    notice = "Cobrado ${euros(request.amount ?: 0.0)} · Pendiente ${euros(result.order.pending)}$change",
                )
                onResult(result.order)
            }
        }
    }

    /** Mesa abierta por error: se libera sin factura */
    fun releaseTable() {
        val order = _state.value.order ?: return
        runBusy {
            container.apiClient.service().closeOrder(order.id, CloseRequest("CASH"))
            _state.value = _state.value.copy(closed = true, closedMessage = "Mesa liberada")
        }
    }

    private fun runBusy(block: suspend () -> Unit) {
        viewModelScope.launch {
            _state.value = _state.value.copy(busy = true, error = null)
            try {
                block()
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.toUserMessage())
            } finally {
                _state.value = _state.value.copy(busy = false)
            }
        }
    }

    override fun onCleared() {
        socketManager?.close()
        super.onCleared()
    }

    companion object {
        fun factory(container: AppContainer, tableId: Int) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                OrderViewModel(container, tableId) as T
        }
    }
}

fun euros(value: Double): String = "${"%.2f".format(value).replace('.', ',')} €"
