package com.tpv.comandas.ui.tables

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tpv.comandas.AppContainer
import com.tpv.comandas.data.model.DashboardSummary
import com.tpv.comandas.data.model.Zone
import com.tpv.comandas.data.network.SocketManager
import com.tpv.comandas.data.network.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class TablesUiState(
    val zones: List<Zone> = emptyList(),
    val summary: DashboardSummary? = null,
    val loading: Boolean = true,
    val error: String? = null,
)

class TablesViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(TablesUiState())
    val state: StateFlow<TablesUiState> = _state.asStateFlow()

    private var socketManager: SocketManager? = null

    init {
        refresh()
        listenForUpdates()
    }

    fun refresh() {
        viewModelScope.launch {
            try {
                val service = container.apiClient.service()
                val zones = service.zones()
                val summary = service.dashboardSummary()
                _state.value = _state.value.copy(zones = zones, summary = summary, loading = false, error = null)
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.toUserMessage())
            }
        }
    }

    private fun listenForUpdates() {
        val manager = container.newSocketManager()
        socketManager = manager
        viewModelScope.launch {
            manager.events().collect { refresh() }
        }
    }

    fun logout() {
        socketManager?.close()
        container.prefs.clearSession()
    }

    override fun onCleared() {
        socketManager?.close()
        super.onCleared()
    }

    companion object {
        fun factory(container: AppContainer) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                TablesViewModel(container) as T
        }
    }
}
