# TPV — Arquitectura

Réplica funcional de un TPV de hostelería estilo MissTipsi: un servidor local que
corre en un PC de la sala (integrado en la app de escritorio), un panel web de
control en tiempo real, y una app Android para que los camareros manden
comandas desde la mesa.

## Componentes

```
                 +--------------------+
                 |  Android (camarero)|
                 |  Kotlin/Compose    |
                 +---------+----------+
                           | HTTP REST + Socket.IO (WiFi/LAN)
                           v
+----------------+   +----+-----------------------+
|  Web control    |<->|  Servidor (Node/Express)   |
|  React + Vite   |   |  + Socket.IO + SQLite      |
+----------------+    +----------------------------+
                           ^
                           | el mismo proceso, embebido
                 +---------+----------+
                 |  App de escritorio  |
                 |  Electron           |
                 +--------------------+
```

- **server/**: backend Node/TypeScript. Expone API REST + WebSocket (Socket.IO).
  Es la fuente de verdad: mesas, productos, comandas, usuarios. Guarda todo en
  SQLite (fichero local, sin dependencias externas). Es el proceso que la app
  de escritorio arranca y al que se conectan tanto el panel web como los
  móviles Android de la misma red local.
- **web/**: SPA en React que consume la API del servidor y se suscribe a los
  eventos de Socket.IO para reflejar el estado del salón (mesas libres,
  ocupadas, cuenta pedida...) en tiempo real. Sirve tanto como "panel de
  control" remoto (abierto en un navegador) como interfaz embebida en la app
  de escritorio.
- **desktop/**: shell de Electron que arranca el servidor Node en el mismo
  proceso/máquina y carga el panel web como interfaz nativa de escritorio.
  Así, "la app de escritorio funciona también como servidor para los
  móviles": el móvil Android se conecta a la IP local de ese PC.
- **android/**: app nativa (Kotlin + Jetpack Compose) para camareros. Login
  por PIN, mapa de mesas, catálogo de productos por categorías, construir la
  comanda y enviarla a cocina/barra. Se conecta al servidor por IP:puerto
  configurable (descubrimiento manual, como MissTipsi).

## Modelo de datos (server/prisma/schema.prisma)

- `User`: camarero/admin, login por PIN, rol (`ADMIN` | `WAITER` | `KITCHEN`).
- `Zone`: zona del salón (Terraza, Interior...).
- `Table`: mesa (número, zona, capacidad, estado: `FREE` | `OCCUPIED` |
  `BILL_REQUESTED`).
- `Category`: familia de producto (Bebidas, Comida...), con `printerTag`
  (cocina/barra) para saber a qué destino se manda al imprimir/notificar.
- `Product`: nombre, precio, categoría, disponible sí/no.
- `Order` (comanda): ligada a una mesa, estado (`OPEN` | `SENT` | `SERVED` |
  `PAID` | `CANCELLED`), camarero, líneas.
- `OrderLine`: producto, cantidad, precio unitario, nota, estado de envío
  (`PENDING` | `SENT`) — permite mandar solo las líneas nuevas cuando se
  añaden productos a una comanda ya abierta.

## API REST (server)

Base `http://<host>:4000/api`

- `POST /auth/login` `{ pin }` → `{ token, user }`
- `GET /zones` / `GET /tables` — estado actual de todas las mesas
- `POST /tables/:id/open` — abre mesa (crea `Order` en `OPEN` si no existe)
- `GET /categories` con productos anidados
- `GET /orders/:tableId` — comanda activa de una mesa
- `POST /orders/:id/lines` `{ productId, qty, note }` — añade línea(s)
- `DELETE /orders/:id/lines/:lineId` — quita línea (solo si no enviada)
- `POST /orders/:id/send` — marca líneas `PENDING` como `SENT` y emite evento
  de cocina/barra
- `POST /orders/:id/close` `{ paymentMethod }` — cobra y libera la mesa
- `GET /dashboard/summary` — ventas del día, mesas ocupadas, ticket medio

Autenticación: `Authorization: Bearer <token>` (JWT simple, sin expirar en
turno). Todas las rutas devuelven JSON.

## Eventos Socket.IO

Namespace `/realtime`, salas por `venue` (de momento una única sala global).

- `table:updated` → `{ table }` (cambio de estado/ocupación)
- `order:updated` → `{ order }` (líneas añadidas, importe, estado)
- `order:sent` → `{ order, lines }` (para pantallas de cocina/barra, filtrable
  por `printerTag`)
- `order:closed` → `{ tableId }`

El cliente web y el cliente Android usan el mismo contrato de eventos.

## Puesta en marcha

```bash
# servidor
cd server && npm install && npm run dev     # http://localhost:4000

# panel web
cd web && npm install && npm run dev        # http://localhost:5173

# escritorio (arranca el servidor embebido + shell nativo)
cd desktop && npm install && npm run dev

# android
abrir android/ en Android Studio, configurar IP del servidor en el login
```
