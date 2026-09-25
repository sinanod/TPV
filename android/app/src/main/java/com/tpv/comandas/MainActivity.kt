package com.tpv.comandas

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.tpv.comandas.ui.login.LoginScreen
import com.tpv.comandas.ui.order.OrderScreen
import com.tpv.comandas.ui.tables.TablesScreen
import com.tpv.comandas.ui.theme.TpvTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = AppContainer(this)

        setContent {
            TpvTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val navController = rememberNavController()
                    val startDestination =
                        if (container.prefs.token != null) "tables" else "login"

                    NavHost(navController = navController, startDestination = startDestination) {
                        composable("login") {
                            LoginScreen(container) {
                                navController.navigate("tables") {
                                    popUpTo("login") { inclusive = true }
                                }
                            }
                        }
                        composable("tables") {
                            TablesScreen(
                                container = container,
                                onSelectTable = { table ->
                                    navController.navigate("order/${table.id}/${table.number}")
                                },
                                onLogout = {
                                    navController.navigate("login") {
                                        popUpTo("tables") { inclusive = true }
                                    }
                                },
                            )
                        }
                        composable(
                            "order/{tableId}/{tableNumber}",
                            arguments = listOf(
                                navArgument("tableId") { type = NavType.IntType },
                                navArgument("tableNumber") { type = NavType.IntType },
                            ),
                        ) { backStackEntry ->
                            val tableId = backStackEntry.arguments?.getInt("tableId") ?: 0
                            val tableNumber = backStackEntry.arguments?.getInt("tableNumber") ?: 0
                            OrderScreen(
                                container = container,
                                tableId = tableId,
                                tableNumber = tableNumber,
                                onBack = { navController.popBackStack() },
                            )
                        }
                    }
                }
            }
        }
    }
}
