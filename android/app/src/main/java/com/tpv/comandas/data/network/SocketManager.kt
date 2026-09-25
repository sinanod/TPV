package com.tpv.comandas.data.network

import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/**
 * Conexión al namespace /realtime del servidor. Emite un evento cada vez que
 * llega cualquiera de los eventos que nos interesan (no hace falta distinguir
 * el payload: ante cualquiera de ellos, la pantalla vuelve a pedir el estado
 * actual por REST).
 */
class SocketManager(private val serverUrl: String) {
    private var socket: Socket? = null

    fun events(): Flow<String> = callbackFlow {
        val opts = IO.Options().apply { transports = arrayOf("websocket") }
        val s = IO.socket("$serverUrl/realtime", opts)
        socket = s

        val relevant = arrayOf("table:updated", "order:updated", "order:sent", "order:closed")
        val listeners = relevant.map { event ->
            event to io.socket.emitter.Emitter.Listener { trySend(event) }
        }
        listeners.forEach { (event, listener) -> s.on(event, listener) }
        s.connect()

        awaitClose {
            listeners.forEach { (event, listener) -> s.off(event, listener) }
            s.disconnect()
            socket = null
        }
    }

    fun close() {
        socket?.disconnect()
        socket = null
    }
}
