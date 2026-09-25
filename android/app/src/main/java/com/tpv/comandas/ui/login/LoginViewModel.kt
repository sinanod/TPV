package com.tpv.comandas.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tpv.comandas.AppContainer
import com.tpv.comandas.data.model.LoginRequest
import com.tpv.comandas.data.network.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class LoginUiState(
    val serverUrl: String = "",
    val pin: String = "",
    val loading: Boolean = false,
    val error: String? = null,
)

class LoginViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(LoginUiState(serverUrl = container.prefs.serverUrl))
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun onServerUrlChange(value: String) {
        _state.value = _state.value.copy(serverUrl = value, error = null)
    }

    fun onPinChange(value: String) {
        _state.value = _state.value.copy(pin = value, error = null)
    }

    fun login(onSuccess: () -> Unit) {
        val current = _state.value
        if (current.serverUrl.isBlank() || current.pin.isBlank()) return

        _state.value = current.copy(loading = true, error = null)
        container.prefs.serverUrl = current.serverUrl

        viewModelScope.launch {
            try {
                val response = container.apiClient.service().login(LoginRequest(current.pin))
                container.prefs.token = response.token
                container.prefs.user = response.user
                _state.value = _state.value.copy(loading = false)
                onSuccess()
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.toUserMessage())
            }
        }
    }

    companion object {
        fun factory(container: AppContainer) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                LoginViewModel(container) as T
        }
    }
}
