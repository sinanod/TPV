// Infraestructura del portal TPV en Azure:
// Container Registry + App Service (Linux, contenedor) + PostgreSQL Flexible Server.
//
// az deployment group create -g <grupo> -f cloud/infra/main.bicep \
//   -p namePrefix=tpv postgresAdminPassword=<...> jwtSecret=<...>

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
