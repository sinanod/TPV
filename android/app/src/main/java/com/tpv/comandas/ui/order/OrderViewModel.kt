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
import com.tpv.comandas.data.network.SocketManager
import com.tpv.comandas.data.network.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class OrderUiState(
    val categories: List<Category> = emptyList(),
    val order: Order? = null,
    val selectedCategoryId: Int? = null,
    val loading: Boolean = true,
    val busy: Boolean = false,
    val error: String? = null,
    val closed: Boolean = false,
)

class OrderViewModel(private val container: AppContainer, private val tableId: Int) : ViewModel() {
    private val _state = MutableStateFlow(OrderUiState())
    val state: StateFlow<OrderUiState> = _state.asStateFlow()

    private var socketManager: SocketManager? = null

    init {
        loadAll()
        listenForUpdates()
    }

    private fun loadAll() {
        viewModelScope.launch {
            try {
                val service = container.apiClient.service()
                val categories = if (_state.value.categories.isEmpty()) service.categories() else _state.value.categories
                var order = runCatching { service.orderForTable(tableId) }.getOrNull()
                if (order == null) {
                    service.openTable(tableId)
                    order = service.orderForTable(tableId)
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

    private fun listenForUpdates() {
        val manager = container.newSocketManager()
        socketManager = manager
        viewModelScope.launch {
            manager.events().collect { loadAll() }
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
            val updated = container.apiClient.service().sendOrder(order.id)
            _state.value = _state.value.copy(order = updated)
        }
    }

    fun closeOrder(paymentMethod: String) {
        val order = _state.value.order ?: return
        runBusy {
            container.apiClient.service().closeOrder(order.id, CloseRequest(paymentMethod))
            _state.value = _state.value.copy(closed = true)
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
