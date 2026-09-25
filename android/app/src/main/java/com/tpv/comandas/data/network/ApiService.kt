package com.tpv.comandas.data.network

import com.tpv.comandas.data.model.AddLinesRequest
import com.tpv.comandas.data.model.CloseRequest
import com.tpv.comandas.data.model.DashboardSummary
import com.tpv.comandas.data.model.LoginRequest
import com.tpv.comandas.data.model.LoginResponse
import com.tpv.comandas.data.model.Category
import com.tpv.comandas.data.model.OpenTableResponse
import com.tpv.comandas.data.model.Order
import com.tpv.comandas.data.model.Zone
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface ApiService {
    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @GET("api/zones")
    suspend fun zones(): List<Zone>

    @GET("api/categories")
    suspend fun categories(): List<Category>

    @POST("api/tables/{id}/open")
    suspend fun openTable(@Path("id") tableId: Int): OpenTableResponse

    @POST("api/tables/{id}/request-bill")
    suspend fun requestBill(@Path("id") tableId: Int)

    @GET("api/orders/table/{tableId}")
    suspend fun orderForTable(@Path("tableId") tableId: Int): Order

    @POST("api/orders/{id}/lines")
    suspend fun addLines(@Path("id") orderId: Int, @Body body: AddLinesRequest): Order

    @DELETE("api/orders/{id}/lines/{lineId}")
    suspend fun deleteLine(@Path("id") orderId: Int, @Path("lineId") lineId: Int): Order

    @POST("api/orders/{id}/send")
    suspend fun sendOrder(@Path("id") orderId: Int): Order

    @POST("api/orders/{id}/close")
    suspend fun closeOrder(@Path("id") orderId: Int, @Body body: CloseRequest)

    @GET("api/dashboard/summary")
    suspend fun dashboardSummary(): DashboardSummary
}
