package com.tpv.comandas.ui.order

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.tpv.comandas.AppContainer
import com.tpv.comandas.data.model.Product

@Composable
fun OrderScreen(
    container: AppContainer,
    tableId: Int,
    tableNumber: Int,
    onBack: () -> Unit,
) {
    val viewModel: OrderViewModel = viewModel(factory = OrderViewModel.factory(container, tableId))
    val state by viewModel.state.collectAsState()

    LaunchedEffect(state.closed) {
        if (state.closed) onBack()
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Mesa $tableNumber") }) },
    ) { padding ->
        if (state.loading) {
            CircularProgressIndicator(modifier = Modifier.padding(padding).padding(24.dp))
        } else {
            OrderContent(state, viewModel, Modifier.padding(padding).fillMaxSize())
        }
    }
}

@Composable
private fun OrderContent(
    state: OrderUiState,
    viewModel: OrderViewModel,
    modifier: Modifier,
) {
    Column(modifier = modifier) {
        state.error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(8.dp))
        }

        LazyRow(modifier = Modifier.padding(8.dp)) {
            items(state.categories) { category ->
                val selected = category.id == state.selectedCategoryId
                Text(
                    category.name,
                    modifier = Modifier
                        .padding(end = 8.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface)
                        .clickable { viewModel.selectCategory(category.id) }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }

        val products: List<Product> =
            state.categories.find { it.id == state.selectedCategoryId }?.products ?: emptyList()

        LazyColumn(modifier = Modifier.weight(1f).padding(horizontal = 8.dp)) {
            items(products) { product ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = !state.busy) { viewModel.addProduct(product.id) }
                        .padding(vertical = 10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(product.name)
                    Text("${"%.2f".format(product.price)} €")
                }
                HorizontalDivider()
            }
        }

        HorizontalDivider()
        Text("Comanda", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(8.dp))
        LazyColumn(modifier = Modifier.padding(horizontal = 8.dp).weight(1f)) {
            items(state.order?.lines ?: emptyList()) { line ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("${line.qty}× ${line.product.name}${line.note?.let { " ($it)" } ?: ""}")
                    Row {
                        Text("${"%.2f".format(line.qty * line.unitPrice)} €")
                        if (line.status == "PENDING") {
                            Text(
                                "  Quitar",
                                color = MaterialTheme.colorScheme.error,
                                modifier = Modifier.clickable(enabled = !state.busy) { viewModel.removeLine(line.id) },
                            )
                        }
                    }
                }
            }
        }

        Text(
            "Total: ${"%.2f".format(state.order?.total ?: 0.0)} €",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(8.dp),
        )

        val hasPending = state.order?.lines?.any { it.status == "PENDING" } == true
        Row(modifier = Modifier.fillMaxWidth().padding(8.dp)) {
            Button(
                onClick = viewModel::sendToKitchen,
                enabled = hasPending && !state.busy,
                modifier = Modifier.weight(1f),
            ) { Text("Enviar") }
        }
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
            Button(
                onClick = { viewModel.closeOrder("CASH") },
                enabled = !state.busy,
                modifier = Modifier.weight(1f).padding(end = 4.dp),
            ) { Text("Cobrar efectivo") }
            Button(
                onClick = { viewModel.closeOrder("CARD") },
                enabled = !state.busy,
                modifier = Modifier.weight(1f).padding(start = 4.dp),
            ) { Text("Cobrar tarjeta") }
        }
    }
}
