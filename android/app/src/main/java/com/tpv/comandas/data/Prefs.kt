package com.tpv.comandas.data

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.tpv.comandas.data.model.User

/**
 * Persistencia simple de sesión: URL del servidor, token y usuario. No hace
 * falta nada más sofisticado que SharedPreferences para un TPV de un único
 * local con sesiones por turno.
 */
class Prefs(context: Context) {
    private val sp: SharedPreferences =
        context.getSharedPreferences("tpv_prefs", Context.MODE_PRIVATE)
    private val gson = Gson()

    var serverUrl: String
        get() = sp.getString(KEY_SERVER_URL, "") ?: ""
        set(value) = sp.edit().putString(KEY_SERVER_URL, value.trimEnd('/')).apply()

    var token: String?
        get() = sp.getString(KEY_TOKEN, null)
        set(value) = sp.edit().putString(KEY_TOKEN, value).apply()

    var user: User?
        get() = sp.getString(KEY_USER, null)?.let { gson.fromJson(it, User::class.java) }
        set(value) = sp.edit().putString(KEY_USER, value?.let { gson.toJson(it) }).apply()

    fun clearSession() {
        sp.edit().remove(KEY_TOKEN).remove(KEY_USER).apply()
    }

    companion object {
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_TOKEN = "token"
        private const val KEY_USER = "user"
    }
}
