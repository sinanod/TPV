package com.tpv.comandas.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Background = Color(0xFF14181F)
val Surface = Color(0xFF1E2430)
val Primary = Color(0xFF4C8BF5)
val StatusFree = Color(0xFF2E7D4F)
val StatusOccupied = Color(0xFFB8562F)
val StatusBillRequested = Color(0xFFB5943B)
val TextPrimary = Color(0xFFEEF1F5)
val TextSecondary = Color(0xFF9AA4B2)

private val TpvColorScheme = darkColorScheme(
    primary = Primary,
    background = Background,
    surface = Surface,
    onBackground = TextPrimary,
    onSurface = TextPrimary,
)

@Composable
fun TpvTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = TpvColorScheme, content = content)
}
