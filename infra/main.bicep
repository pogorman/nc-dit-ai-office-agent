// ============================================================================
// main.bicep — Orchestrates all modules for NC DIT AI Office Agent
// ============================================================================

targetScope = 'resourceGroup'

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

@description('Environment name used in resource naming (dev, staging, prod)')
@allowed(['dev', 'staging', 'prod'])
param environmentName string

@description('Azure region for all resources')
param location string = 'eastus2'

@description('Project prefix used in resource naming')
param projectName string = 'nc-comms-agent'

// ---------------------------------------------------------------------------
// Variables — Naming convention: {projectName}-{resourceType}-{environmentName}
// ---------------------------------------------------------------------------

var namingPrefix = '${projectName}-${environmentName}'

// Storage accounts have strict naming rules (no hyphens, max 24 chars)
var storageAccountName = replace('${take(projectName, 10)}stor${environmentName}', '-', '')

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

module openai 'modules/openai.bicep' = {
  name: 'openai-deployment'
  params: {
    name: '${namingPrefix}-oai'
    location: location
  }
}

module aiSearch 'modules/ai-search.bicep' = {
  name: 'ai-search-deployment'
  params: {
    name: '${namingPrefix}-search'
    location: location
  }
}

module cosmosDb 'modules/cosmos-db.bicep' = {
  name: 'cosmos-db-deployment'
  params: {
    name: '${namingPrefix}-cosmos'
    location: location
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage-deployment'
  params: {
    name: storageAccountName
    location: location
  }
}

module keyVault 'modules/key-vault.bicep' = {
  name: 'key-vault-deployment'
  params: {
    name: '${namingPrefix}-kv'
    location: location
  }
}

module functionApp 'modules/function-app.bicep' = {
  name: 'function-app-deployment'
  params: {
    name: '${namingPrefix}-func'
    location: location
    storageAccountName: storage.outputs.name
    openaiEndpoint: openai.outputs.endpoint
    aiSearchEndpoint: aiSearch.outputs.endpoint
    cosmosDbEndpoint: cosmosDb.outputs.endpoint
    cosmosDbDatabaseName: cosmosDb.outputs.databaseName
    keyVaultUri: keyVault.outputs.uri
  }
}

module apim 'modules/apim.bicep' = {
  name: 'apim-deployment'
  params: {
    name: '${namingPrefix}-apim'
    location: location
    functionAppName: functionApp.outputs.name
    functionAppBaseUrl: functionApp.outputs.baseUrl
    keyVaultUri: keyVault.outputs.uri
  }
}

module roleAssignments 'modules/role-assignments.bicep' = {
  name: 'role-assignments-deployment'
  params: {
    functionAppPrincipalId: functionApp.outputs.principalId
    apimPrincipalId: apim.outputs.principalId
    openaiAccountName: openai.outputs.name
    aiSearchName: aiSearch.outputs.name
    cosmosDbAccountName: cosmosDb.outputs.name
    storageAccountName: storage.outputs.name
    keyVaultName: keyVault.outputs.name
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output functionAppName string = functionApp.outputs.name
output functionAppBaseUrl string = functionApp.outputs.baseUrl
output apimGatewayUrl string = apim.outputs.gatewayUrl
output openaiEndpoint string = openai.outputs.endpoint
output aiSearchEndpoint string = aiSearch.outputs.endpoint
output cosmosDbEndpoint string = cosmosDb.outputs.endpoint
output storageAccountName string = storage.outputs.name
output keyVaultUri string = keyVault.outputs.uri
