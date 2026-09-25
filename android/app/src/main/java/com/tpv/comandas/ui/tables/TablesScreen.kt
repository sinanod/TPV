package com.tpv.comandas.ui.tables

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.tpv.comandas.AppContainer
import com.tpv.comandas.data.model.TableInfo
import com.tpv.comandas.ui.theme.StatusBillRequested
import com.tpv.comandas.ui.theme.StatusFree
import com.tpv.comandas.ui.theme.StatusOccupied

@Composable
fun TablesScreen(
    container: AppContainer,
    onSelectTable: (TableInfo) -> Unit,
    onLogout: () -> Unit,
) {
    val viewModel: TablesViewModel = viewModel(factory = TablesViewModel.factory(container))
    val state by viewModel.state.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Mesas") },
                actions = {
                    Text(
                        "Salir",
                        modifier = Modifier
                            .padding(end = 16.dp)
                            .clickable { viewModel.logout(); onLogout() },
                    )
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            state.summary?.let { summary ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    SummaryItem("${"%.2f".format(summary.revenueToday)} €", "Ventas hoy")
                    SummaryItem("${summary.tables.occupied}", "Ocupadas")
                    SummaryItem("${summary.tables.free}", "Libres")
                }
            }

            when {
                state.loading -> CircularProgressIndicator(modifier = Modifier.padding(24.dp))
                state.error != null -> Text(
                    state.error ?: "",
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(16.dp),
                )
                else -> state.zones.forEach { zone ->
                    Text(
                        zone.name.uppercase(),
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp),
                    )
                    TableGrid(zone.tables, columns = 3, onSelectTable = onSelectTable)
                }
            }
        }
    }
}

/** Cuadrícula simple por filas: el número de mesas por local es pequeño, no
 * hace falta virtualización con LazyVerticalGrid (que no puede anidarse
 * dentro de una Column ya scrollable). */
@Composable
private fun TableGrid(tables: List<TableInfo>, columns: Int, onSelectTable: (TableInfo) -> Unit) {
    Column(modifier = Modifier.padding(horizontal = 6.dp)) {
        tables.chunked(columns).forEach { rowTables ->
            Row(modifier = Modifier.fillMaxWidth()) {
                rowTables.forEach { table ->
                    Box(modifier = Modifier.weight(1f)) {
                        TableTile(table, onClick = { onSelectTable(table) })
                    }
                }
                repeat(columns - rowTables.size) {
                    Box(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun SummaryItem(value: String, label: String) {
    Column {
        Text(value, style = MaterialTheme.typography.titleMedium)
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun TableTile(table: TableInfo, onClick: () -> Unit) {
    val color = when (table.status) {
        "OCCUPIED" -> StatusOccupied
        "BILL_REQUESTED" -> StatusBillRequested
        else -> StatusFree
    }
    val label = when (table.status) {
        "OCCUPIED" -> "Ocupada"
        "BILL_REQUESTED" -> "Cuenta"
        else -> "Libre"
    }
    Column(
        modifier = Modifier
            .padding(6.dp)
            .aspectRatio(1f)
            .clip(RoundedCornerShape(10.dp))
            .background(color)
            .clickable(onClick = onClick),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
    ) {
        Text("Mesa ${table.number}", color = Color.White, style = MaterialTheme.typography.titleMedium)
        Text(label, color = Color.White, style = MaterialTheme.typography.labelSmall)
    }
}
