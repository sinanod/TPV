package com.tpv.comandas

import android.content.Context
import com.tpv.comandas.data.Prefs
import com.tpv.comandas.data.network.ApiClient
import com.tpv.comandas.data.network.SocketManager

/** Contenedor de dependencias manual: la app es pequeña y no necesita Hilt. */
class AppContainer(context: Context) {
    val prefs = Prefs(context.applicationContext)
    val apiClient = ApiClient(prefs)

    fun newSocketManager(): SocketManager = SocketManager(prefs.serverUrl)
}
