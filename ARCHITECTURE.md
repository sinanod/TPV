# TPV — Arquitectura

TPV de hostelería al estilo MissTipsi con dos niveles:

- **En cada restaurante**, un TPV local completo: app de escritorio (que es
  también el servidor) + app Android para los camareros. Es lo único que
  opera: abrir mesas, comandas, envío a cocina/barra y cobro. Funciona sin
  internet.
- **En la nube (Azure)**, un único portal de administración para todos los
  restaurantes. Cada restaurante entra con el usuario y contraseña que le da
  el operador de la plataforma. El portal no hace operaciones de TPV: muestra
  el estado en vivo y las ventas, y gestiona la configuración (carta, salón,
  personal).

```
                        Azure (una instalación para todos)
              +--------------------------------------------------+
              |  cloud/server  (Express + Socket.IO + Prisma)     |
              |     PostgreSQL, datos separados por restaurante  |
              |  cloud/portal  (React, lo sirve cloud/server)     |
              +------------------^-------------------^------------+
          HTTPS: eventos arriba  |                   |  HTTPS
          config abajo (socket)  |                   |  navegador del dueño
                                 |                   |
  Restaurante A                  |          Restaurante B ...
  +------------------------------+----+
  | desktop/ (Electron)               |
  |   └─ server/  Node + SQLite  <--- LAN --- android/ (camareros)
  |        └─ web/ (UI del TPV)       |
  +-----------------------------------+
```

## Componentes

| Carpeta | Dónde corre | Qué es |
|---|---|---|
| `server/` | PC del restaurante | API REST + Socket.IO + SQLite. Fuente de verdad de la operación. Sincroniza con la nube si está vinculado. |
| `web/` | PC del restaurante | Interfaz del TPV (la sirve `server/`, la muestra `desktop/`). Incluye la pantalla de vinculación con el portal. |
| `desktop/` | PC del restaurante | Electron: arranca `server/` y muestra `web/`. Enseña la IP local para la app Android. |
| `android/` | Móviles de los camareros | Comandas contra el servidor local por la WiFi del local. |
| `cloud/server/` | Azure | API multi-restaurante, sincronización, CLI de altas. |
| `cloud/portal/` | Azure | Web de administración. |

## Quién manda sobre qué

| Dato | Fuente de verdad | Dirección |
|---|---|---|
| Carta, zonas/mesas, personal (PIN) | Portal | nube → local (snapshot completo versionado) |
| Estado de mesas, comandas, cobros | TPV local | local → nube (eventos) |

Con el TPV sin vincular, todo es local (modo autónomo, con los datos de demo
de `npm run seed`). Al vincularlo, la configuración local se sustituye por la
del portal; lo anterior queda desactivado (`active = false`), no se borra,
porque comandas antiguas lo referencian.

## Sincronización

### Vincular (una vez por TPV)

`POST /api/setup/cloud/link` en el servidor local con la URL del portal y el
usuario/contraseña del restaurante → el servidor local llama a
`POST /api/sync/register` en la nube, que devuelve un **token de dispositivo**
(en la nube solo se guarda su hash). La contraseña no se almacena en el TPV.
Solo se puede vincular sin mesas abiertas, y para desvincular hay que volver a
dar la contraseña (cualquiera en la WiFi del local llega al servidor local).

### Subida: outbox

Cada cambio de mesa o comanda en el TPV encola un evento en la tabla
`OutboxEvent` (SQLite) con el estado completo de esa mesa/comanda. Al encolar
se descartan los pendientes con la misma clave, así una comanda editada 20
veces sin conexión se envía una sola vez. Un worker los envía en lotes a
`POST /api/sync/events` cada pocos segundos y los borra al confirmarse.

- La nube aplica cada evento solo si es más reciente que lo que tiene
  (`sourceAt`/`statusAt`): los reintentos y el desorden no hacen retroceder
  el estado.
- Un evento mal formado se rechaza individualmente; no bloquea la cola.
- En cada reconexión el TPV reenvía el estado de todas las mesas y comandas
  abiertas, así la nube converge aunque se haya perdido algo.

Eventos:

- `table.status` → `{ tableId (id de la nube), status }`
- `order.upsert` → `{ localUuid, tableId, tableLabel, waiterName, status,
  paymentMethod, total, openedAt, closedAt, lines[] }`. `tableLabel` y los
  nombres de producto van copiados para que el informe de ventas no cambie
  si luego se renombra o borra algo en la carta.

### Bajada: configuración

Cada cambio en el portal incrementa `Tenant.configVersion` y emite
`config:updated` por el namespace `/device` de Socket.IO. El TPV descarga el
snapshot (`GET /api/sync/config`) y lo aplica en una transacción, haciendo
upsert por `cloudId`. Además consulta la versión cada 5 minutos por si se
perdió algún aviso. Al aplicarse, el servidor local emite `config:updated` a
la UI del TPV y a Android, que recargan.

Si en el portal se da de baja a un camarero, su sesión en el TPV deja de
valer al llegar la configuración.

## Autenticación

| Quién | Cómo | Token |
|---|---|---|
| Restaurante en el portal | usuario + contraseña (bcrypt), con rate limit | JWT 12 h, se revalida que la cuenta siga activa en cada petición |
| TPV local frente a la nube | token de dispositivo aleatorio (256 bits) | revocable desde el portal |
| Personal en el TPV local | PIN | JWT local 12 h, se revalida que el usuario siga activo |
| Operador de la plataforma | CLI con acceso a la base de datos | — |

Los tokens de portal y de dispositivo no son intercambiables.

## API del servidor local (`server/`, puerto 4000)

- `POST /api/auth/login { pin }` → `{ token, user }`
- `GET /api/zones`, `GET /api/tables`, `GET /api/categories`
- `POST /api/tables/:id/open`, `POST /api/tables/:id/request-bill`
- `GET /api/orders/table/:tableId`, `GET /api/orders/:id`
- `POST /api/orders/:id/lines`, `DELETE /api/orders/:id/lines/:lineId`
- `POST /api/orders/:id/send`, `POST /api/orders/:id/close { paymentMethod }`
- `GET /api/dashboard/summary`
- Vinculación (sin PIN): `GET /api/setup/cloud`,
  `POST /api/setup/cloud/link`, `POST /api/setup/cloud/unlink`,
  `POST /api/setup/cloud/sync`

Socket.IO `/realtime`: `table:updated`, `order:updated`, `order:sent`,
`order:closed`, `config:updated`.

## API de la nube (`cloud/server`, puerto 8080)

- Portal: `POST /api/auth/login`, `GET /api/auth/me`,
  `GET /api/portal/overview|floor|orders/open|sales`,
  `DELETE /api/portal/devices/:id`, CRUD de
  `/api/portal/categories|products|zones|tables|staff`, `GET /api/portal/catalog`
- Sincronización: `POST /api/sync/register`, `GET /api/sync/config`,
  `POST /api/sync/events`
- Socket.IO `/portal` (token de portal): `live:updated`, `config:updated`,
  `devices:updated`. `/device` (token de dispositivo): `config:updated`.

Detalle de despliegue y operación: [`cloud/README.md`](./cloud/README.md).
