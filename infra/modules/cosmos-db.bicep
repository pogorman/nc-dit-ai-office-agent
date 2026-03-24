// ============================================================================
// cosmos-db.bicep — Serverless Cosmos DB (NoSQL API)
// ============================================================================

@description('Resource name for the Cosmos DB account')
param name string

@description('Azure region')
param location string

// ---------------------------------------------------------------------------
// Cosmos DB Account — Serverless
// ---------------------------------------------------------------------------

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: name
  location: location
  kind: 'GlobalDocumentDB'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    // Disable key-based auth — managed identity only
    disableLocalAuth: false // Set to true once all clients use MI
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
  }
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmosAccount
  name: 'comms-agent'
  properties: {
    resource: {
      id: 'comms-agent'
    }
  }
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

resource clipsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'clips'
  properties: {
    resource: {
      id: 'clips'
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
        version: 2
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          { path: '/*' }
        ]
        excludedPaths: [
          { path: '/"_etag"/?' }
        ]
      }
    }
  }
}

resource ingestionStateContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'ingestion-state'
  properties: {
    resource: {
      id: 'ingestion-state'
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
        version: 2
      }
    }
  }
}

resource remarksChunksContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'remarks-chunks'
  properties: {
    resource: {
      id: 'remarks-chunks'
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
        version: 2
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          { path: '/*' }
        ]
        excludedPaths: [
          { path: '/"_etag"/?' }
        ]
      }
    }
  }
}

resource remarksMetadataContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'remarks-metadata'
  properties: {
    resource: {
      id: 'remarks-metadata'
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
        version: 2
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output name string = cosmosAccount.name
output endpoint string = cosmosAccount.properties.documentEndpoint
output databaseName string = database.name
