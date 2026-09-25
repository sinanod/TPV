package com.tpv.comandas.data.network

import com.google.gson.Gson
import com.tpv.comandas.data.Prefs
import com.tpv.comandas.data.model.ApiErrorBody
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Reconstruye el cliente Retrofit cuando cambia la URL del servidor (el
 * camarero puede apuntar a otro local sin reinstalar la app). El interceptor
 * añade el token de sesión en cada petición.
 */
class ApiClient(private val prefs: Prefs) {
    private var cachedBaseUrl: String? = null
    private var cachedService: ApiService? = null

    fun service(): ApiService {
        val baseUrl = prefs.serverUrl
        require(baseUrl.isNotBlank()) { "No se ha configurado la URL del servidor" }
        val normalized = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"

        if (cachedService == null || cachedBaseUrl != normalized) {
            val authInterceptor = okhttp3.Interceptor { chain ->
                val request = chain.request().newBuilder().apply {
                    prefs.token?.let { addHeader("Authorization", "Bearer $it") }
                }.build()
                chain.proceed(request)
            }

            val logging = HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BASIC
            }

            val okHttpClient = OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .addInterceptor(authInterceptor)
                .addInterceptor(logging)
                .build()

            cachedService = Retrofit.Builder()
                .baseUrl(normalized)
                .client(okHttpClient)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
                .create(ApiService::class.java)
            cachedBaseUrl = normalized
        }
        return cachedService!!
    }
}

/** Extrae el mensaje `{ "error": "..." }` que devuelve el servidor. */
fun Throwable.toUserMessage(): String {
    if (this is HttpException) {
        val body = response()?.errorBody()?.string()
        val parsed = body?.let {
            runCatching { Gson().fromJson(it, ApiErrorBody::class.java) }.getOrNull()
        }
        return parsed?.error ?: "Error del servidor (${code()})"
    }
    return message ?: "No se pudo conectar con el servidor"
}
