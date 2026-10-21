package com.tpv.comandas.ui.order

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.tpv.comandas.data.model.Order
import com.tpv.comandas.data.model.PaymentRequest
import kotlin.math.abs
import kotlin.math.ceil

private val METHOD_LABEL = mapOf("CASH" to "Efectivo", "CARD" to "Tarjeta", "ONLINE" to "Pago móvil")

private fun parseEuros(text: String): Double? =
    text.replace(',', '.').trim().toDoubleOrNull()?.let { Math.round(it * 100) / 100.0 }

private fun toInput(value: Double): String = "%.2f".format(value).replace('.', ',')

/** Parte de un reparto a partes iguales, redondeada hacia arriba al céntimo */
private fun share(pending: Double, ways: Int): Double = ceil(pending / ways * 100) / 100

/**
 * Cobro de la mesa: total o por partes (importe libre o a partes iguales),
 * en efectivo con cálculo del cambio o con tarjeta, y opcionalmente con el
 * email del cliente para que le llegue el ticket. También eligiendo qué
 * artículos paga cada uno. El último pago cierra la cuenta y emite la factura.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaymentDialog(
    order: Order,
    busy: Boolean,
    error: String?,
    onPay: (PaymentRequest, onResult: (Order) -> Unit) -> Unit,
    onDismiss: () -> Unit,
) {
    var method by remember { mutableStateOf("CARD") }
    var amount by remember { mutableStateOf(toInput(order.pending)) }
    var splitWays by remember { mutableStateOf("") }
    var tendered by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf<String?>(null) }
    var byItems by remember { mutableStateOf(false) }
    val selected = remember { mutableStateMapOf<String, Int>() }

    val groups = remember(order.lines) { groupLines(order.lines) }
    val itemsCents = selectionCents(groups, selected)
    // Si antes se cobró algo por importe, lo pendiente puede ser menos que lo que valen
    val itemsAmount = minOf(itemsCents, Math.round(order.pending * 100).toInt()) / 100.0

    val amountValue = if (byItems) itemsAmount else parseEuros(amount)
    val tenderedValue = parseEuros(tendered)
    val change = if (method == "CASH" && amountValue != null && tenderedValue != null && tenderedValue > amountValue) {
        tenderedValue - amountValue
    } else {
        0.0
    }
    val isFinal = amountValue != null && abs(amountValue - order.pending) < 0.005

    fun split(text: String) {
        splitWays = text.filter { it.isDigit() }
        splitWays.toIntOrNull()?.takeIf { it > 1 }?.let { amount = toInput(share(order.pending, it)) }
    }

    fun submit() {
        localError = when {
            byItems && itemsCents == 0 -> "Elige qué artículos se pagan"
            amountValue == null || amountValue <= 0 -> "Indica un importe mayor que cero"
            amountValue > order.pending + 0.005 -> "Lo pendiente es ${euros(order.pending)}"
            method == "CASH" && tenderedValue != null && tenderedValue < amountValue -> "El efectivo entregado no cubre el importe"
            email.isNotBlank() && !android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches() -> "El email no es válido"
            else -> null
        }
        if (localError != null || amountValue == null) return
        val request = PaymentRequest(
            method = method,
            amount = if (byItems) null else amountValue,
            tendered = if (method == "CASH") tenderedValue else null,
            email = email.trim().ifBlank { null },
            items = if (byItems) toItems(groups, selected) else null,
        )
        onPay(request) { updated ->
            selected.clear()
            // Al dividir, la siguiente parte se calcula con los que quedan por pagar
            val remainingWays = (splitWays.toIntOrNull() ?: 0) - 1
            if (remainingWays > 1) {
                splitWays = remainingWays.toString()
                amount = toInput(share(updated.pending, remainingWays))
            } else {
                splitWays = ""
                amount = toInput(updated.pending)
            }
            tendered = ""
            email = ""
        }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Cobrar") },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                TotalRow("Total", order.total)
                if (order.paid > 0) TotalRow("Ya pagado", order.paid)
                TotalRow("Pendiente", order.pending, strong = true)

                order.payments.filter { it.amount > 0 }.forEach { p ->
                    Text(
                        "${METHOD_LABEL[p.method] ?: p.method} · ${euros(p.amount)}" +
                            (p.items?.takeIf { it.isNotEmpty() }?.let { " · ${it.sumOf { i -> i.qty }} artículo(s)" } ?: "") +
                            (p.email?.let { " · $it" } ?: ""),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }

                Row(modifier = Modifier.padding(vertical = 8.dp)) {
                    listOf("CARD", "CASH").forEach { m ->
                        FilterChip(
                            selected = method == m,
                            onClick = { method = m },
                            label = { Text(METHOD_LABEL.getValue(m)) },
                            modifier = Modifier.padding(end = 8.dp),
                        )
                    }
                }

                Row(modifier = Modifier.padding(bottom = 4.dp)) {
                    FilterChip(
                        selected = !byItems,
                        onClick = { byItems = false },
                        label = { Text("Importe") },
                        modifier = Modifier.padding(end = 8.dp),
                    )
                    FilterChip(
                        selected = byItems,
                        onClick = { byItems = true },
                        enabled = groups.isNotEmpty(),
                        label = { Text("Por artículos") },
                    )
                }

                if (byItems) {
                    ItemPicker(
                        groups = groups,
                        selected = selected,
                        onChange = { key, qty -> selected[key] = qty.coerceAtLeast(0) },
                        onSelectAll = { all ->
                            selected.clear()
                            if (all) groups.forEach { selected[it.key] = it.available }
                        },
                    )
                    Text(
                        "Importe: ${euros(itemsAmount)}" +
                            if (itemsCents / 100.0 > itemsAmount) " (solo queda eso por pagar)" else "",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(vertical = 4.dp),
                    )
                } else {
                    OutlinedTextField(
                        value = amount,
                        onValueChange = { amount = it },
                        label = { Text("Importe de este pago") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = splitWays,
                        onValueChange = ::split,
                        label = { Text("Dividir entre (nº de personas)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (method == "CASH") {
                    OutlinedTextField(
                        value = tendered,
                        onValueChange = { tendered = it },
                        label = { Text("Entregado (para el cambio)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (change > 0) {
                    Text(
                        "Cambio: ${euros(change)}",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(vertical = 4.dp),
                    )
                }
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email del cliente para el ticket (opcional)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                (localError ?: error)?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
                }
            }
        },
        confirmButton = {
            Button(onClick = ::submit, enabled = !busy) {
                val label = euros(amountValue ?: 0.0)
                Text(if (busy) "Cobrando…" else if (isFinal) "Cobrar $label y cerrar" else "Cobrar $label")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancelar") }
        },
    )
}

@Composable
private fun TotalRow(label: String, value: Double, strong: Boolean = false) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        val style = if (strong) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium
        Text(label, style = style)
        Text(euros(value), style = style)
    }
}
