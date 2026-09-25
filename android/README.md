# TPV Comandas (Android)

App nativa para camareros: login por PIN, mapa de mesas en tiempo real y envío
de comandas a cocina/barra. Kotlin + Jetpack Compose + Retrofit + Socket.IO.
Contrato de API/eventos: ver `../ARCHITECTURE.md`.

## Estructura

```
app/src/main/java/com/tpv/comandas/
  AppContainer.kt          // dependencias manuales (sin Hilt)
  MainActivity.kt          // NavHost: login -> mesas -> comanda
  data/
    Prefs.kt                // sesión: URL servidor, token, usuario
    model/Models.kt          // DTOs (coinciden con el JSON del servidor)
    network/
      ApiService.kt          // interfaz Retrofit
      ApiClient.kt           // Retrofit + interceptor de Authorization
      SocketManager.kt       // conexión Socket.IO a /realtime
  ui/
    login/    LoginScreen + LoginViewModel
    tables/   TablesScreen (mapa de mesas) + TablesViewModel
    order/    OrderScreen (comanda) + OrderViewModel
    theme/    colores y tema oscuro (a juego con el panel web)
```

## Cómo se conecta

En el login se introduce la URL del servidor (`http://<ip-del-pc>:4000`, la
misma que muestra la app de escritorio en la franja inferior de su ventana) y
el PIN del camarero. A partir de ahí:

- REST vía Retrofit con un interceptor que añade `Authorization: Bearer <token>`.
- Tiempo real vía Socket.IO (`/realtime`): cualquier evento (`table:updated`,
  `order:updated`, `order:sent`, `order:closed`) dispara una recarga del
  estado desde REST — igual que hace el panel web.

## Build

Este proyecto se ha escrito y revisado a mano en un entorno sin SDK de
Android (el proxy de red del contenedor bloquea `dl.google.com` /
`maven.google.com`, así que no se pudo ejecutar `gradle assembleDebug` aquí).
Para compilarlo:

1. Abrir la carpeta `android/` en Android Studio (Ladybug o posterior) — se
   encargará de generar el wrapper de Gradle y descargar el SDK/AGP.
2. Sincronizar Gradle.
3. Ejecutar en un emulador o dispositivo físico en la misma red WiFi que el
   servidor.

Usuarios de demo (mismos que en el servidor): PIN `1111`/`2222` (camareros).
