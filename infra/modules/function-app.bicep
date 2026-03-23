// ============================================================================
// function-app.bicep — Flex Consumption Function App (Node.js 20 / TypeScript)
// ============================================================================

@description('Resource name for the Function App')
param name string

@description('Azure region')
param location string

@description('Name of the storage account used by the Function App runtime')
param storageAccountName string

@description('Azure OpenAI endpoint URL')
param openaiEndpoint string

@description('Azure AI Search endpoint URL')
param aiSearchEndpoint string

@description('Cosmos DB account endpoint URL')
param cosmosDbEndpoint string

@description('Cosmos DB database name')
param cosmosDbDatabaseName string

@description('Key Vault URI for secret references')
param keyVaultUri string

// ---------------------------------------------------------------------------
// Reference existing storage account (created by storage module)
// ---------------------------------------------------------------------------

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

// ---------------------------------------------------------------------------
// Flex Consumption Plan
// ---------------------------------------------------------------------------

resource flexPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: '${name}-plan'
  location: location
  kind: 'functionapp'
  sku: {
    tier: 'FlexConsumption'
    name: 'FC1'
  }
  properties: {
    reserved: true // Required for Linux
  }
}

// ---------------------------------------------------------------------------
// Function App
// ---------------------------------------------------------------------------

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: name
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: flexPlan.id
    httpsOnly: true
    siteConfig: {
      // Flex Consumption uses this property for runtime stack
      linuxFxVersion: 'Node|20'
      appSettings: [
        // --- Function runtime ---
        {
          name: 'AzureWebJobsStorage__accountName'
          value: storageAccountName
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        // --- Azure OpenAI (endpoint only — auth via managed identity) ---
        {
          name: 'AZURE_OPENAI_ENDPOINT'
          value: openaiEndpoint
        }
        {
          name: 'AZURE_OPENAI_DEPLOYMENT_GPT'
          value: 'gpt-4o'
        }
        {
          name: 'AZURE_OPENAI_DEPLOYMENT_EMBEDDING'
          value: 'text-embedding-3-large'
        }
        // --- Azure AI Search (endpoint only) ---
        {
          name: 'AZURE_SEARCH_ENDPOINT'
          value: aiSearchEndpoint
        }
        {
          name: 'AZURE_SEARCH_INDEX_CLIPS'
          value: 'clips'
        }
        {
          name: 'AZURE_SEARCH_INDEX_REMARKS'
          value: 'remarks'
        }
        // --- Cosmos DB (endpoint only — auth via managed identity) ---
        {
          name: 'COSMOS_DB_ENDPOINT'
          value: cosmosDbEndpoint
        }
        {
          name: 'COSMOS_DB_DATABASE'
          value: cosmosDbDatabaseName
        }
        // --- Key Vault ---
        {
          name: 'KEY_VAULT_URI'
          value: keyVaultUri
        }
        // --- Blob Storage (account name only — auth via managed identity) ---
        {
          name: 'STORAGE_ACCOUNT_NAME'
          value: storageAccountName
        }
      ]
      cors: {
        // Allow local dev and Copilot Studio origins
        allowedOrigins: [
          'http://localhost:3000'
          'http://localhost:7071'
          'https://copilotstudio.microsoft.com'
        ]
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output name string = functionApp.name
output baseUrl string = 'https://${functionApp.properties.defaultHostName}'
output principalId string = functionApp.identity.principalId
