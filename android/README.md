# TPV Comandas (Android)

App nativa para camareros: login por PIN, mapa de mesas en tiempo real, envío
de comandas (cada familia sale por su impresora) y cobro de la mesa, entero,
por partes o eligiendo artículos, en efectivo o con tarjeta, con email del
cliente para el ticket. Kotlin + Jetpack Compose + Retrofit + Socket.IO.
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
    order/    OrderScreen (comanda) + OrderViewModel + PaymentDialog (cobro) + ItemPicker
    theme/    colores y tema oscuro (a juego con el panel web)
```

## Cómo se conecta

En el login se introduce la URL del servidor (`http://<ip-del-pc>:4000`, la
misma que muestra la app de escritorio en la franja inferior de su ventana) y
el PIN del camarero. A partir de ahí:

- REST vía Retrofit con un interceptor que añade `Authorization: Bearer <token>`.
- Tiempo real vía Socket.IO (`/realtime`): cualquier evento (`table:updated`,
  `order:updated`, `order:sent`, `order:closed`, `payment:online`) dispara
  una recarga del estado desde REST — igual que hace el panel web. Si la
  cuenta se cierra en otro sitio (el TPV o el cliente pagando con el QR), la
  pantalla de la mesa vuelve al mapa.
- Si una impresora falla al enviar, la app lo avisa; el reintento se hace
  desde el TPV.

## Build

Con Android Studio (Ladybug o posterior): abrir la carpeta `android/`,
sincronizar Gradle y ejecutar en un emulador o móvil en la misma WiFi que el
servidor. Desde terminal, con el SDK de Android (plataforma 34) y Gradle 8.7+:

```bash
ANDROID_HOME=~/Android/Sdk gradle :app:assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

Usuarios de demo (mismos que en el servidor): PIN `1111`/`2222` (camareros).
