package com.tpv.comandas.ui.order

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.tpv.comandas.data.model.ItemRequest
import com.tpv.comandas.data.model.OrderLine

/**
 * Líneas iguales (mismo producto, precio y nota) juntas: «3 × Caña» aunque se
 * pidieran en rondas distintas. Lo elegido se reparte después entre ellas.
 */
data class ItemGroup(
    val key: String,
    val name: String,
    val note: String?,
    val unitCents: Int,
    val available: Int,
    val lines: List<Pair<Int, Int>>, // id de línea → unidades sin pagar
)

fun groupLines(lines: List<OrderLine>): List<ItemGroup> =
    lines.filter { it.qty - it.paidQty > 0 }
        .groupBy { "${it.productId}|${Math.round(it.unitPrice * 100)}|${it.note.orEmpty()}" }
        .map { (key, group) ->
            val first = group.first()
            ItemGroup(
                key = key,
                name = first.product.name,
                note = first.note,
                unitCents = Math.round(first.unitPrice * 100).toInt(),
                available = group.sumOf { it.qty - it.paidQty },
                lines = group.map { it.id to (it.qty - it.paidQty) },
            )
        }

fun toItems(groups: List<ItemGroup>, selected: Map<String, Int>): List<ItemRequest> =
    groups.flatMap { g ->
        var left = minOf(selected[g.key] ?: 0, g.available)
        g.lines.mapNotNull { (lineId, available) ->
            val qty = minOf(left, available)
            left -= qty
            if (qty > 0) ItemRequest(lineId, qty) else null
        }
    }

fun selectionCents(groups: List<ItemGroup>, selected: Map<String, Int>): Int =
    groups.sumOf { it.unitCents * minOf(selected[it.key] ?: 0, it.available) }

@Composable
fun ItemPicker(
    groups: List<ItemGroup>,
    selected: Map<String, Int>,
    onChange: (key: String, qty: Int) -> Unit,
    onSelectAll: (Boolean) -> Unit,
) {
    val any = selected.values.any { it > 0 }
    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Toca lo que paga este cliente", style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = { onSelectAll(!any) }) { Text(if (any) "Ninguno" else "Todo") }
        }
        groups.forEach { g ->
            val n = minOf(selected[g.key] ?: 0, g.available)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(if (n > 0) MaterialTheme.colorScheme.primary.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surface)
                    .padding(vertical = 4.dp, horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clickable { if (n < g.available) onChange(g.key, n + 1) },
                ) {
                    Text(g.name + (g.note?.let { " · $it" } ?: ""))
                    Text(
                        "${g.available} sin pagar · ${euros(g.unitCents / 100.0)}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                OutlinedButton(
                    onClick = { onChange(g.key, n - 1) },
                    enabled = n > 0,
                    modifier = Modifier.size(40.dp),
                    contentPadding = PaddingValues(0.dp),
                ) { Text("−") }
                Text(
                    "$n",
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.widthIn(min = 32.dp),
                )
                OutlinedButton(
                    onClick = { onChange(g.key, n + 1) },
                    enabled = n < g.available,
                    modifier = Modifier.size(40.dp),
                    contentPadding = PaddingValues(0.dp),
                ) { Text("+") }
            }
        }
    }
}
