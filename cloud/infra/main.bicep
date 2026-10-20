// Infraestructura del portal TPV en Azure:
// Container Registry + App Service (Linux, contenedor) + PostgreSQL Flexible Server.
//
// az deployment group create -g <grupo> -f cloud/infra/main.bicep \
//   -p namePrefix=tpv postgresAdminPassword=<...> jwtSecret=<...> certEncryptionKey=<...> \
//      sifProducerName='Mi Empresa SL' sifProducerNif=B12345674 \
//      smtpHost=smtp.azurecomm.net smtpUser=<...> smtpPass=<...> mailFrom=tickets@<dominio>

@description('Prefijo para los nombres de los recursos (minúsculas y números, 3-12 caracteres).')
@minLength(3)
@maxLength(12)
param namePrefix string

param location string = resourceGroup().location

@description('Usuario administrador de PostgreSQL.')
param postgresAdminLogin string = 'tpvadmin'

@secure()
@minLength(12)
@description('Contraseña del administrador de PostgreSQL.')
param postgresAdminPassword string

@secure()
@minLength(32)
@description('Secreto para firmar las sesiones del portal (p. ej. openssl rand -hex 32).')
param jwtSecret string

@secure()
@minLength(64)
@maxLength(64)
@description('Clave AES-256 en hexadecimal (openssl rand -hex 32) con la que se cifran los certificados de la AEAT de los restaurantes. Si se pierde, hay que volver a subir los certificados.')
param certEncryptionKey string

@description('Razón social de quien produce el sistema de facturación (tú). Va en cada registro VERI*FACTU. Vacío = VERI*FACTU no se podrá activar.')
param sifProducerName string = ''

@description('NIF del productor del sistema de facturación.')
param sifProducerNif string = ''

@description('Nombre del sistema de facturación tal y como figura en la declaración responsable (máx. 30 caracteres).')
@maxLength(30)
param sifSystemName string = 'TPV Restaurantes'

@description('Código de 2 caracteres del sistema de facturación.')
@maxLength(2)
param sifSystemId string = 'TR'

@description('Versión del sistema de facturación declarada.')
param sifVersion string = '1.0.0'

@description('Servidor SMTP para enviar los tickets por correo (p. ej. smtp.azurecomm.net con Azure Communication Services). Vacío = no se envían correos.')
param smtpHost string = ''

param smtpPort int = 587

@description('true solo para SMTPS en el puerto 465; con 587 se usa STARTTLS.')
param smtpSecure bool = false

param smtpUser string = ''

@secure()
param smtpPass string = ''

@description('Remitente de los correos, p. ej. "Tickets <tickets@tudominio.es>" (debe estar verificado en el proveedor SMTP).')
param mailFrom string = ''

@description('URL pública del portal (QR de las mesas y enlaces de los correos). Vacío = la URL de azurewebsites.net. Ponla si usas un dominio propio: cambiarla después invalida los QR impresos.')
param publicBaseUrl string = ''

@description('Pasarela para el pago desde el móvil del cliente: vacío = desactivado; "demo" = solo pruebas, NO cobra.')
@allowed([
  ''
  'demo'
])
param paymentProvider string = ''

@description('Etiqueta de la imagen tpv-cloud en el registro.')
param imageTag string = 'latest'

@description('Plan de App Service. B1 basta para empezar; P0v3 o superior para producción con más carga.')
param appServiceSku string = 'B1'

@description('IP pública del operador para poder ejecutar el CLI de alta de restaurantes contra la base de datos. Vacío = sin regla.')
param operatorIpAddress string = ''

// Nombres globalmente únicos (registro y servidor de PostgreSQL)
var suffix = uniqueString(resourceGroup().id)
var acrName = take('${namePrefix}acr${suffix}', 50)
var webAppName = take('${namePrefix}-portal-${suffix}', 60)
var postgresName = take('${namePrefix}-pg-${suffix}', 63)
var databaseName = 'tpv'
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var portalBaseUrl = empty(publicBaseUrl) ? 'https://${webAppName}.azurewebsites.net' : publicBaseUrl

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2022-12-01' = {
  name: postgresName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32 }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2022-12-01' = {
  parent: postgres
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// 0.0.0.0 es la convención de Azure para "permitir servicios de Azure"
// (incluye App Service). No abre el servidor a internet.
resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2022-12-01' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource allowOperator 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2022-12-01' = if (!empty(operatorIpAddress)) {
  parent: postgres
  name: 'Operador'
  properties: {
    startIpAddress: operatorIpAddress
    endIpAddress: operatorIpAddress
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${namePrefix}-plan'
  location: location
  kind: 'linux'
  sku: { name: appServiceSku }
  properties: {
    reserved: true
  }
}

var databaseUrl = 'postgresql://${uriComponent(postgresAdminLogin)}:${uriComponent(postgresAdminPassword)}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    // Una sola instancia: el estado de conexión de los dispositivos vive en
    // memoria. Para escalar a varias hace falta el adaptador Redis de Socket.IO.
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/tpv-cloud:${imageTag}'
      acrUseManagedIdentityCreds: true
      alwaysOn: true
      webSocketsEnabled: true
      healthCheckPath: '/api/health'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      appSettings: [
        { name: 'WEBSITES_PORT', value: '8080' }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'DATABASE_URL', value: databaseUrl }
        { name: 'JWT_SECRET', value: jwtSecret }
        { name: 'CERT_ENCRYPTION_KEY', value: certEncryptionKey }
        { name: 'PUBLIC_BASE_URL', value: portalBaseUrl }
        { name: 'SIF_PRODUCER_NAME', value: sifProducerName }
        { name: 'SIF_PRODUCER_NIF', value: sifProducerNif }
        { name: 'SIF_SYSTEM_NAME', value: sifSystemName }
        { name: 'SIF_SYSTEM_ID', value: sifSystemId }
        { name: 'SIF_VERSION', value: sifVersion }
        { name: 'SMTP_HOST', value: smtpHost }
        { name: 'SMTP_PORT', value: string(smtpPort) }
        { name: 'SMTP_SECURE', value: string(smtpSecure) }
        { name: 'SMTP_USER', value: smtpUser }
        { name: 'SMTP_PASS', value: smtpPass }
        { name: 'MAIL_FROM', value: mailFrom }
        { name: 'PAYMENT_PROVIDER', value: paymentProvider }
      ]
    }
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, webApp.id, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output portalUrl string = 'https://${webApp.properties.defaultHostName}'
output webAppName string = webApp.name
output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output postgresServerName string = postgres.name
