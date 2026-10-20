# TPV Cloud — portal de administración multi-restaurante

Servicio central que se despliega una sola vez (en Azure) y da servicio a
todos los restaurantes. **No es un TPV**: no permite abrir mesas, tomar
comandas ni cobrar en caja. Eso se hace siempre en el TPV local de cada restaurante
(app de escritorio + Android), que funciona aunque se caiga internet.

Qué hace el portal:

- **En directo** (solo lectura): mesas, comandas abiertas y caja del día.
- **Ventas**: informe por rango de fechas, desglose por forma de pago,
  exportación a CSV.
- **Configuración**: carta por familias, impresoras (cada familia sale por
  la suya), salón (zonas y mesas) y personal (PIN). Los cambios bajan solos
  al TPV local vinculado.
- **Facturas y VERI*FACTU**: facturas emitidas por los TPV, estado de su
  envío a la AEAT, emails de los tickets (reenvío). Cada restaurante decide
  si activa VERI*FACTU y sube su certificado.
- **QR de las mesas**: hoja imprimible; el cliente escanea, ve la cuenta y
  paga desde su móvil (`/m/<token>`, página pública sin login).
- **Dispositivos**: servidores locales vinculados y revocación.

Lo que hace la nube por detrás: remitir a la AEAT los registros de
facturación que generan los TPV, mandar los tickets por email y avisar a los
TPV de los pagos hechos desde el móvil.

```
cloud/
  server/   API + Socket.IO + PostgreSQL (Prisma) + CLI de altas
  portal/   Web del portal (React). En producción la sirve server/
  infra/    Plantilla Bicep para Azure
  Dockerfile
```

## Cómo se relaciona con el TPV local

1. Tú das de alta el restaurante con el CLI y le entregas usuario y
   contraseña.
2. El restaurante entra en el portal con esas credenciales y configura carta,
   mesas y personal (o parte de la carta de demo con `--demo`).
3. En el TPV local (pantalla de login → «Portal: sin vincular · Configurar»)
   se introducen la dirección del portal y las mismas credenciales. El TPV
   recibe un token de dispositivo propio (no guarda la contraseña) y descarga
   la configuración.
4. Desde ese momento el TPV envía cada cambio de mesa, comanda y cobro. Si no
   hay internet los guarda en una cola local y los envía al reconectar.

Todos los datos van separados por restaurante: cada consulta filtra por
restaurante y los eventos en tiempo real viajan por salas independientes.

## Alta y gestión de restaurantes (CLI)

No hay registro público: solo el operador da de alta cuentas.

```bash
cd cloud/server
npm run tenant -- create --name "Bar Pepe" --username barpepe [--password X] [--admin-pin 0000] [--demo]
npm run tenant -- list
npm run tenant -- set-password --username barpepe [--password X]
npm run tenant -- disable --username barpepe    # bloquea portal y sincronización
npm run tenant -- enable --username barpepe
```

- Si no pasas `--password`, se genera una aleatoria y se muestra una sola vez.
- Cada restaurante nace con un **Encargado** (rol ADMIN) con el PIN indicado
  (0000 por defecto) para poder entrar al TPV local tras vincularlo. Conviene
  que lo cambien desde el portal.
- `--demo` crea carta, mesas y camareros de ejemplo.

Contra la base de datos de Azure se ejecuta igual, apuntando `DATABASE_URL` a
ella (ver más abajo).

## Desarrollo local

Requiere Node 22 y PostgreSQL.

```bash
cd cloud/server
cp .env.example .env               # ajusta DATABASE_URL (y SMTP si quieres emails)
npm install
npx prisma migrate dev             # crea las tablas
npm run tenant -- create --name "Demo" --username demo --password demo-password-1 --demo
npm run dev                        # API en http://localhost:8080

cd ../portal
npm install
npm run dev                        # portal en http://localhost:5174 (proxy a :8080)
```

Tests de la API (usan una base de datos aparte que se borra en cada
ejecución; define `TEST_DATABASE_URL` en `server/.env`):

```bash
cd cloud/server && npm test
```

## Despliegue en Azure

Recursos que crea `infra/main.bicep`:

| Recurso | Para qué |
|---|---|
| Azure Container Registry (Basic) | Guarda la imagen `tpv-cloud` |
| App Service Plan Linux (B1) + Web App | Ejecuta el contenedor (API + portal), HTTPS, WebSockets |
| PostgreSQL Flexible Server (B1ms, v16) | Base de datos, backups 7 días |

La Web App descarga la imagen con su identidad administrada (sin
contraseñas del registro) y aplica las migraciones de base de datos al
arrancar.

### Antes de desplegar: qué necesitas

| Para | Necesitas | Parámetro de la plantilla |
|---|---|---|
| Todo | Contraseña de PostgreSQL y secreto de sesiones | `postgresAdminPassword`, `jwtSecret` |
| Guardar los certificados de la AEAT | Una clave AES de 64 hex (`openssl rand -hex 32`). **Guárdala**: si se pierde, cada restaurante tendrá que volver a subir su certificado | `certEncryptionKey` |
| VERI*FACTU | Tus datos como productor del sistema de facturación (los de tu empresa y los del software, los mismos que en tu declaración responsable) | `sifProducerName`, `sifProducerNif`, `sifSystemName`, `sifSystemId`, `sifVersion` |
| Tickets por email | Un servidor SMTP con remitente verificado | `smtpHost`, `smtpPort`, `smtpUser`, `smtpPass`, `mailFrom` |
| QR de las mesas con dominio propio | La URL definitiva del portal (por defecto la de azurewebsites.net). **Cámbiala antes de imprimir los QR**: los ya impresos dejarían de funcionar | `publicBaseUrl` |
| Pago desde el móvil | Hoy solo `demo` (simula el cobro, no mueve dinero). Déjalo vacío en producción hasta integrar una pasarela real | `paymentProvider` |

Sin SMTP los emails se quedan en cola; sin los datos del productor, el
portal no deja activar VERI*FACTU. El resto funciona igual.

**Email con Azure Communication Services**: crea un recurso de
Communication Services + Email Communication Services con un dominio
verificado, y en «SMTP Usernames» un usuario asociado a una aplicación de
Entra ID. Después: `smtpHost=smtp.azurecomm.net`, `smtpPort=587`,
`smtpUser=<usuario SMTP>`, `smtpPass=<secreto de la aplicación>`,
`mailFrom=<remitente del dominio verificado>`. Vale cualquier otro
proveedor SMTP (SendGrid, Mailgun, el de tu dominio…).

### Primer despliegue

Necesitas la [CLI de Azure](https://learn.microsoft.com/cli/azure/install-azure-cli)
y permisos de Owner (o Contributor + User Access Administrator) en el grupo
de recursos, porque la plantilla asigna el rol AcrPull.

```bash
az login
az group create --name tpv-rg --location westeurope

az deployment group create \
  --resource-group tpv-rg \
  --template-file cloud/infra/main.bicep \
  --parameters namePrefix=tpv \
               postgresAdminPassword='<contraseña-larga-para-postgres>' \
               jwtSecret="$(openssl rand -hex 32)" \
               certEncryptionKey="$(openssl rand -hex 32)" \
               sifProducerName='Mi Empresa SL' sifProducerNif=B12345674 \
               smtpHost=smtp.azurecomm.net smtpUser='<usuario>' smtpPass='<secreto>' \
               mailFrom='Tickets <tickets@midominio.es>' \
               operatorIpAddress="$(curl -s https://api.ipify.org)"

# Datos que necesitarás después
az deployment group show -g tpv-rg -n main --query properties.outputs

# Construye la imagen en Azure (no hace falta Docker en tu equipo)
az acr build --registry <acrName> --image tpv-cloud:latest ./cloud

az webapp restart --resource-group tpv-rg --name <webAppName>
```

El portal queda en `portalUrl` (`https://<webAppName>.azurewebsites.net`).
Comprueba `https://.../api/health` → `{"ok":true}`.

Guarda bien la contraseña de PostgreSQL, el `jwtSecret` y la
`certEncryptionKey` (por ejemplo en un gestor de contraseñas). En cada
redespliegue con la plantilla hay que pasar los mismos valores. Si cambias el `jwtSecret`, todas las sesiones del
portal se cierran (los TPV vinculados no se ven afectados).

### Dar de alta restaurantes en producción

La plantilla abre el firewall de PostgreSQL a la IP que pasaste en
`operatorIpAddress`. Desde tu equipo:

```bash
cd cloud/server && npm install
export DATABASE_URL='postgresql://tpvadmin:<contraseña-url-encoded>@<postgresHost>:5432/tpv?sslmode=require'
npm run tenant -- create --name "Bar Pepe" --username barpepe
```

Si tu IP cambia:

```bash
az postgres flexible-server firewall-rule create -g tpv-rg --name <postgresServerName> \
  --rule-name Operador --start-ip-address <tu-ip> --end-ip-address <tu-ip>
```

### Actualizar a una versión nueva

```bash
az acr build --registry <acrName> --image tpv-cloud:latest ./cloud
az webapp restart --resource-group tpv-rg --name <webAppName>
```

Las migraciones nuevas se aplican solas al arrancar el contenedor. Para
poder volver atrás, etiqueta también cada versión (`--image tpv-cloud:v1.2`)
y despliega con `imageTag=v1.2`.

### Logs

```bash
az webapp log config -g tpv-rg -n <webAppName> --docker-container-logging filesystem
az webapp log tail -g tpv-rg -n <webAppName>
```

## VERI*FACTU: qué te toca a ti como proveedor

El software genera y remite los registros como pide la AEAT (Real Decreto
1007/2023 y Orden HAC/1177/2024; obligatorio desde el 1/1/2027 para
sociedades y el 1/7/2027 para el resto, según el RDL 15/2025). Lo que no
puede hacer el software por ti:

- **Declaración responsable**: como productor del sistema tienes que
  firmarla y tenerla a disposición de tus clientes, con los mismos datos que
  pones en `SIF_*`. Cada versión nueva que cambie lo declarado necesita la
  suya (sube `sifVersion`).
- **Probar con la AEAT**: activa VERI*FACTU en entorno **pruebas** para un
  restaurante de prueba con un certificado real (personal o de sello); los
  registros van a `prewww1.aeat.es` y se ven en el portal con su respuesta.
  Aquí solo se ha probado contra una AEAT simulada (mTLS y XSD oficiales).
- **Certificado y representación**: cada restaurante sube el suyo. Si
  prefieres enviar tú con tu certificado en nombre de tus clientes,
  necesitas que te apoderen para este trámite en la AEAT.
- **Activar producción** solo cuando el restaurante esté listo: después del
  primer envío real no se puede volver a pruebas, y desactivarlo solo surte
  efecto al acabar el año.

Pendiente en el software: factura completa (F1, obligatoria por encima de
3.000 € o si el cliente la pide), rectificativas y anulaciones.

## Limitaciones conocidas y siguientes pasos

- **Pago desde el móvil**: solo hay pasarela de demostración. Para cobrar de
  verdad hay que implementar `PaymentProvider` (`src/payments/providers.ts`)
  con Redsys, Stripe, etc.; el resto del flujo (cuenta, avisos al TPV,
  importes parciales, aviso de los que hay que devolver) ya está hecho.
- **Una sola instancia**: el estado «conectado» de los TPV se guarda en
  memoria. Para escalar horizontalmente hay que añadir Azure Cache for Redis
  con el adaptador Redis de Socket.IO. Una instancia B1 aguanta de sobra
  decenas de restaurantes.
- **Secretos en App Settings**: `DATABASE_URL`, `JWT_SECRET`,
  `CERT_ENCRYPTION_KEY` y `SMTP_PASS` están cifrados
  en reposo por App Service. Para más aislamiento, moverlos a Key Vault con
  referencias `@Microsoft.KeyVault(...)`.
- **Red**: PostgreSQL es accesible solo desde servicios de Azure y la IP del
  operador. El siguiente paso de endurecimiento es integración con VNet y
  acceso privado.
- **Importes**: cobros y facturas se calculan en céntimos enteros; la carta y
  el informe de ventas aún guardan importes con decimales redondeados a 2.
