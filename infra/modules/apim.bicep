// ============================================================================
// apim.bicep — Consumption-tier API Management with Function App backend
// ============================================================================

@description('Resource name for the APIM instance')
param name string

@description('Azure region')
param location string

@description('Function App base URL (https://...azurewebsites.net)')
param functionAppBaseUrl string

// ---------------------------------------------------------------------------
// APIM Instance — Consumption tier
// ---------------------------------------------------------------------------

resource apim 'Microsoft.ApiManagement/service@2023-09-01-preview' = {
  name: name
  location: location
  sku: {
    name: 'Consumption'
    capacity: 0
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    publisherEmail: 'dit-ai-office@nc.gov'
    publisherName: 'NC DIT AI Office'
  }
}

// ---------------------------------------------------------------------------
// Named Values
// ---------------------------------------------------------------------------

resource namedValueFunctionBaseUrl 'Microsoft.ApiManagement/service/namedValues@2023-09-01-preview' = {
  parent: apim
  name: 'function-app-base-url'
  properties: {
    displayName: 'function-app-base-url'
    value: functionAppBaseUrl
    secret: false
  }
}

// Function host key — deployed as a placeholder initially.
// Post-deploy steps:
//   1. Copy the Function App host key into Key Vault as secret 'function-host-key'
//   2. Update this named value to use Key Vault reference:
//      az apim nv update --service-name <apim> -g <rg> --named-value-id function-host-key \
//        --secret true --value "" --key-vault-secret-id <kv-uri>/secrets/function-host-key
resource namedValueFunctionKey 'Microsoft.ApiManagement/service/namedValues@2023-09-01-preview' = {
  parent: apim
  name: 'function-host-key'
  properties: {
    displayName: 'function-host-key'
    secret: true
    value: 'PLACEHOLDER-UPDATE-POST-DEPLOY'
  }
}

// ---------------------------------------------------------------------------
// API Definition — Comms Agent API
// ---------------------------------------------------------------------------

resource api 'Microsoft.ApiManagement/service/apis@2023-09-01-preview' = {
  parent: apim
  name: 'comms-agent-api'
  properties: {
    displayName: 'NC Comms Agent API'
    description: 'Backend API for the NC Governor Communications Office AI Agent'
    path: 'comms'
    protocols: ['https']
    subscriptionRequired: true
    subscriptionKeyParameterNames: {
      header: 'Ocp-Apim-Subscription-Key'
      query: 'subscription-key'
    }
    serviceUrl: '${functionAppBaseUrl}/api'
  }
  dependsOn: [namedValueFunctionBaseUrl, namedValueFunctionKey]
}

// ---------------------------------------------------------------------------
// Global API Policy — Function key injection + rate limiting
// ---------------------------------------------------------------------------

resource apiPolicy 'Microsoft.ApiManagement/service/apis/policies@2023-09-01-preview' = {
  parent: api
  name: 'policy'
  properties: {
    format: 'xml'
    value: '''
<policies>
  <inbound>
    <base />
    <!-- Inject Function host key from Key Vault via named value -->
    <set-header name="x-functions-key" exists-action="override">
      <value>{{function-host-key}}</value>
    </set-header>
    <!-- Rate limiting: 60 calls per minute per subscription -->
    <rate-limit calls="60" renewal-period="60" />
  </inbound>
  <backend>
    <base />
  </backend>
  <outbound>
    <base />
  </outbound>
  <on-error>
    <base />
  </on-error>
</policies>
'''
  }
}

// ---------------------------------------------------------------------------
// API Operations
// ---------------------------------------------------------------------------

resource operationClipsQuery 'Microsoft.ApiManagement/service/apis/operations@2023-09-01-preview' = {
  parent: api
  name: 'clips-query'
  properties: {
    displayName: 'Query Clips'
    description: 'Search and browse news clips mentioning the Governor'
    method: 'POST'
    urlTemplate: '/clips/query'
    request: {
      representations: [
        {
          contentType: 'application/json'
        }
      ]
    }
    responses: [
      {
        statusCode: 200
        description: 'Clip results'
        representations: [
          {
            contentType: 'application/json'
          }
        ]
      }
    ]
  }
}

resource operationRemarksQuery 'Microsoft.ApiManagement/service/apis/operations@2023-09-01-preview' = {
  parent: api
  name: 'remarks-query'
  properties: {
    displayName: 'Query Remarks'
    description: 'Semantic search over historical Governor remarks'
    method: 'POST'
    urlTemplate: '/remarks/query'
    request: {
      representations: [
        {
          contentType: 'application/json'
        }
      ]
    }
    responses: [
      {
        statusCode: 200
        description: 'Remarks search results with synthesized response'
        representations: [
          {
            contentType: 'application/json'
          }
        ]
      }
    ]
  }
}

resource operationProofread 'Microsoft.ApiManagement/service/apis/operations@2023-09-01-preview' = {
  parent: api
  name: 'proofread'
  properties: {
    displayName: 'Proofread Transcript'
    description: 'Clean up faulty transcripts using GPT-4o'
    method: 'POST'
    urlTemplate: '/proofread'
    request: {
      representations: [
        {
          contentType: 'application/json'
        }
      ]
    }
    responses: [
      {
        statusCode: 200
        description: 'Corrected transcript with change summary'
        representations: [
          {
            contentType: 'application/json'
          }
        ]
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output name string = apim.name
output gatewayUrl string = apim.properties.gatewayUrl
output principalId string = apim.identity.principalId
