// ============================================================================
// ai-search.bicep — Azure AI Search (Basic tier) with semantic configuration
// ============================================================================

@description('Resource name for the AI Search service')
param name string

@description('Azure region')
param location string

// ---------------------------------------------------------------------------
// Azure AI Search
// ---------------------------------------------------------------------------

resource searchService 'Microsoft.Search/searchServices@2024-06-01-preview' = {
  name: name
  location: location
  sku: {
    name: 'basic'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    replicaCount: 1
    partitionCount: 1
    hostingMode: 'default'
    publicNetworkAccess: 'enabled'
    // Semantic search is enabled at the service level
    semanticSearch: 'standard'
    // Enforce RBAC — no API key auth for data plane
    authOptions: {
      aadOrApiKey: {
        aadAuthFailureMode: 'http401WithBearerChallenge'
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output name string = searchService.name
output endpoint string = 'https://${searchService.name}.search.windows.net'
output principalId string = searchService.identity.principalId
