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
| Carta y familias, impresoras, zonas/mesas, personal (PIN), datos fiscales, VERI*FACTU sí/no | Portal | nube → local (snapshot completo versionado) |
| Estado de mesas, comandas, cobros | TPV local | local → nube (eventos) |
| Facturas simplificadas y su registro VERI*FACTU (huella, QR) | TPV local (las genera) | local → nube, que las guarda tal cual y las remite a la AEAT |
| Pagos desde el móvil del cliente | Nube (pasarela) | nube → local, el TPV los registra como un cobro más |
| Impresoras USB instaladas en el PC | App de escritorio | local → nube (para elegirlas en el portal) |

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
  paymentMethod, total, openedAt, closedAt, lines[], payments[],
  invoiceNumber }`. `tableLabel` y los nombres de producto van copiados para
  que el informe de ventas no cambie si luego se renombra o borra algo en la
  carta.
- `invoice.issued` → la factura con su registro de alta VERI*FACTU ya
  generado (XML, huella, QR) y los emails a los que mandar el ticket. Es
  inmutable: la nube la guarda una vez y nunca la modifica; mientras haya
  alguna sin subir, el TPV no se deja desvincular.
- `invoice.email` → reenviar el ticket de una factura a otro email.
- `payment.applied` → el TPV confirma que registró un pago móvil (o que hay
  que devolverlo porque la cuenta ya estaba cobrada).
- `device.printers` → impresoras instaladas en el PC (las USB que ve la app
  de escritorio).

### Bajada: configuración

Cada cambio en el portal incrementa `Tenant.configVersion` y emite
`config:updated` por el namespace `/device` de Socket.IO. El TPV descarga el
snapshot (`GET /api/sync/config`) y lo aplica en una transacción, haciendo
upsert por `cloudId`. Además consulta la versión cada 5 minutos por si se
perdió algún aviso. Al aplicarse, el servidor local emite `config:updated` a
la UI del TPV y a Android, que recargan.

Si en el portal se da de baja a un camarero, su sesión en el TPV deja de
valer al llegar la configuración.

## Familias e impresoras

Cada producto pertenece a una familia (categoría) y cada familia tiene una
impresora: al enviar una comanda, el TPV agrupa las líneas nuevas por
impresora y saca un ticket en cada una (bebidas en barra, platos en cocina,
etc.). Las impresoras se dan de alta en el portal y son de dos tipos:

- **Red** (`NETWORK`): impresora térmica ESC/POS con IP fija, puerto 9100.
  El servidor local le manda el ticket directamente por TCP (página de
  códigos PC858 para tildes y €, corte de papel, QR nativo).
- **Instalada en el PC** (`SYSTEM`): USB o compartida, con su driver del
  sistema. El servidor no puede imprimir en ellas; lo hace la app de
  escritorio, que se conecta al namespace `/print-agent` del servidor local
  con un token que genera al arrancarlo, informa de las impresoras que ve y
  recibe el documento en HTML para imprimirlo en silencio.

Cada impresión queda en la tabla `PrintJob`. Si falla (impresora apagada,
sin papel…), el TPV lo avisa en pantalla y en la cabecera («⚠ N sin
imprimir») hasta que se reintenta o se descarta: un plato que no se imprime
es un plato que no sale. Además de las comandas, se imprimen la cuenta
previa («Imprimir cuenta», no es factura) y el ticket/factura al cobrar, en
la impresora de tickets elegida en el portal.

## Cobros

Una mesa se puede cobrar de una vez o por partes:

- **En el TPV o en Android**: importe libre o «dividir entre N» (el reparto
  se recalcula tras cada pago), efectivo con cálculo del cambio o tarjeta,
  y opcionalmente el email del cliente.
- **Desde el móvil del cliente**: cada mesa tiene un QR (se imprimen desde
  el portal) que abre `/m/<token>` en el portal. El cliente ve la cuenta,
  paga todo o una parte y deja su email. La nube avisa al TPV
  (`payments:pending` por socket, y además lo consulta cada minuto), que lo
  registra como un pago `ONLINE` de esa comanda.

Todos los importes se calculan en céntimos enteros. El pago que completa la
cuenta emite la factura simplificada, libera la mesa e imprime el ticket.
Reglas:

- No se puede cobrar con tarjeta más de lo pendiente; con efectivo sí (es el
  cambio).
- No se pueden quitar líneas por debajo de lo ya cobrado.
- Una factura simplificada no puede superar 3.000 € (IVA incluido); por
  encima el TPV pide hacer factura completa (no implementada todavía).
- Si un pago móvil llega cuando la cuenta ya estaba cobrada en el TPV, se
  registra con importe 0 y se marca para devolver; el TPV y el portal lo
  avisan.
- Los pagos móviles son idempotentes: si el aviso llega dos veces, se
  registra una.

La pasarela es intercambiable (`PaymentProvider` en `cloud/server`). Hoy
solo existe el proveedor `demo`, que simula el cobro sin mover dinero.

## Facturación y VERI*FACTU

El TPV numera las facturas simplificadas con una serie por equipo
(`T<n>-AAAA-000001`; `L-…` si no está vinculado) para que dos TPV del mismo
restaurante nunca repitan número. Cada factura lleva el desglose de IVA por
tipo (cada producto tiene el suyo, 10 % por defecto).

**VERI*FACTU es opcional y lo activa cada restaurante desde su portal**
(Ajustes → Facturación). El sistema funciona en modalidad «solo
VERI*FACTU»: si está activado, todas las facturas se remiten a la AEAT; si
no, se emiten igual pero sin registro ni QR tributario.

Con VERI*FACTU activado, al emitir cada factura el TPV local:

1. Genera el registro de alta (`RegistroAlta`, tipo F2) según el XSD
   oficial, encadenado con la huella del registro anterior de ese equipo.
2. Calcula la huella SHA-256 con el algoritmo de la AEAT (verificado con sus
   ejemplos oficiales en los tests).
3. Imprime el QR tributario al principio del ticket, con los textos
   «QR tributario:» y «VERI*FACTU».

La nube recibe el registro sin tocarlo y lo envía al servicio web de la
AEAT (SOAP con certificado de cliente):

- Con el certificado del restaurante (o un certificado de sello), que el
  restaurante sube en el portal. Se guarda cifrado (AES-256-GCM con
  `CERT_ENCRYPTION_KEY`).
- Agrupando hasta 1.000 registros por envío y respetando el tiempo de
  espera que devuelve la AEAT entre envíos (60 s por defecto).
- Guardando la respuesta de cada registro (correcto, aceptado con errores,
  rechazado) y el CSV del envío. En el portal se ven en «Facturas».
- Entorno de **pruebas** o **producción**, elegido en el portal. Tras el
  primer envío real a producción no se puede volver a pruebas, y
  desactivarlo solo surte efecto al terminar el año (se comunica a la AEAT
  con `FechaFinVeriFactu`).

Esto es lo que avala la propia AEAT (FAQ de diciembre de 2025): el TPV
genera registro y QR, y otro componente del mismo sistema los remite sin
alterarlos.

Pendiente: facturas completas (F1), rectificativas y anulaciones.

## Emails al cliente

Si en el cobro se indica un email (en el TPV, en Android o en el pago
móvil), la nube manda el ticket por correo al cerrar la cuenta, con el QR
tributario incrustado. Los envíos van por SMTP desde una cola con
reintentos (hasta 5, caducan a los 7 días); el estado de cada email se ve en
el portal y desde ahí o desde el TPV se puede reenviar a otro email.

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
- `POST /api/orders/:id/send` → la comanda + `prints[]` (resultado por
  impresora)
- `POST /api/orders/:id/payments { method: CASH|CARD, amount?, tendered?,
  email? }` → `{ order, change, invoice, receiptPrint }`. Sin `amount`, cobra
  todo lo pendiente.
- `POST /api/orders/:id/close { paymentMethod, email? }` → cobra todo lo
  pendiente de una vez, o libera la mesa si no tiene consumiciones
- `POST /api/orders/:id/print-bill` → cuenta previa
- `GET /api/invoices?day=AAAA-MM-DD`, `POST /api/invoices/:id/print`,
  `POST /api/invoices/:id/email { email }`
- `GET /api/printers`, `POST /api/printers/:id/test`,
  `GET /api/print-jobs/failed`, `POST /api/print-jobs/:id/retry|dismiss`
- `GET /api/dashboard/summary`
- Vinculación (sin PIN): `GET /api/setup/cloud`,
  `POST /api/setup/cloud/link`, `POST /api/setup/cloud/unlink`,
  `POST /api/setup/cloud/sync`

Socket.IO `/realtime`: `table:updated`, `order:updated`, `order:sent`,
`order:closed`, `config:updated`, `payment:online`,
`print:failed`. `/print-agent`: solo para la app de escritorio.

## API de la nube (`cloud/server`, puerto 8080)

- Portal: `POST /api/auth/login`, `GET /api/auth/me`,
  `GET /api/portal/overview|floor|orders/open|sales`,
  `DELETE /api/portal/devices/:id`, CRUD de
  `/api/portal/categories|products|printers|zones|tables|staff`,
  `GET /api/portal/catalog`, `GET /api/portal/tables/qr`,
  `POST /api/portal/tables/:id/qr/rotate`
- Facturación: `GET /api/portal/invoices`, `POST /api/portal/invoices/:id/email`,
  `GET /api/portal/verifactu/submissions`, `GET /api/portal/online-payments`,
  `GET /api/portal/settings`, `PUT /api/portal/settings/business|verifactu|certificate|online-payments`,
  `DELETE /api/portal/settings/certificate`
- Público (cliente en la mesa, sin login): `GET /api/public/tables/:token`,
  `POST /api/public/tables/:token/payments`, `GET /api/public/payments/:id`
- Sincronización: `POST /api/sync/register`, `GET /api/sync/config`,
  `POST /api/sync/events`, `GET /api/sync/online-payments`
- Socket.IO `/portal` (token de portal): `live:updated`, `config:updated`,
  `devices:updated`. `/device` (token de dispositivo): `config:updated`,
`payments:pending`.

Detalle de despliegue y operación: [`cloud/README.md`](./cloud/README.md).
