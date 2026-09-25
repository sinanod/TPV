# TPV Cloud — portal de administración multi-restaurante

Servicio central que se despliega una sola vez (en Azure) y da servicio a
todos los restaurantes. **No es un TPV**: no permite abrir mesas, tomar
comandas ni cobrar. Eso se hace siempre en el TPV local de cada restaurante
(app de escritorio + Android), que funciona aunque se caiga internet.

Qué hace el portal:

- **En directo** (solo lectura): mesas, comandas abiertas y caja del día.
- **Ventas**: informe por rango de fechas, desglose por forma de pago,
  exportación a CSV.
- **Configuración**: carta, salón (zonas y mesas) y personal (PIN). Los
  cambios bajan solos al TPV local vinculado.
- **Dispositivos**: servidores locales vinculados y revocación.

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
cp .env.example .env               # ajusta DATABASE_URL
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
               operatorIpAddress="$(curl -s https://api.ipify.org)"

# Datos que necesitarás después
az deployment group show -g tpv-rg -n main --query properties.outputs

# Construye la imagen en Azure (no hace falta Docker en tu equipo)
az acr build --registry <acrName> --image tpv-cloud:latest ./cloud

az webapp restart --resource-group tpv-rg --name <webAppName>
```

El portal queda en `portalUrl` (`https://<webAppName>.azurewebsites.net`).
Comprueba `https://.../api/health` → `{"ok":true}`.

Guarda bien la contraseña de PostgreSQL y el `jwtSecret` (por ejemplo en un
gestor de contraseñas). Si cambias el `jwtSecret`, todas las sesiones del
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

## Limitaciones conocidas y siguientes pasos

- **Una sola instancia**: el estado «conectado» de los TPV se guarda en
  memoria. Para escalar horizontalmente hay que añadir Azure Cache for Redis
  con el adaptador Redis de Socket.IO. Una instancia B1 aguanta de sobra
  decenas de restaurantes.
- **Secretos en App Settings**: `DATABASE_URL` y `JWT_SECRET` están cifrados
  en reposo por App Service. Para más aislamiento, moverlos a Key Vault con
  referencias `@Microsoft.KeyVault(...)`.
- **Red**: PostgreSQL es accesible solo desde servicios de Azure y la IP del
  operador. El siguiente paso de endurecimiento es integración con VNet y
  acceso privado.
- **Importes** en coma flotante redondeados a 2 decimales. Si más adelante se
  necesita contabilidad estricta, pasar a céntimos enteros en ambos lados.
