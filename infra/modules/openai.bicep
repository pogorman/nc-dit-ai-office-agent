// ============================================================================
// openai.bicep — Azure OpenAI account with GPT-4o and embedding deployments
// ============================================================================

@description('Resource name for the Azure OpenAI account')
param name string

@description('Azure region')
param location string

// ---------------------------------------------------------------------------
// Azure OpenAI Account
// ---------------------------------------------------------------------------

resource openaiAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: name
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: name
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
    }
  }
}

// ---------------------------------------------------------------------------
// Model Deployments
// ---------------------------------------------------------------------------

resource gpt4oDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openaiAccount
  name: 'gpt-4o'
  sku: {
    name: 'Standard'
    capacity: 30 // 30K TPM — adjust as needed
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o'
      version: '2024-11-20'
    }
  }
}

resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openaiAccount
  name: 'text-embedding-3-large'
  sku: {
    name: 'Standard'
    capacity: 120 // 120K TPM for embedding throughput
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'text-embedding-3-large'
      version: '1'
    }
  }
  // Deployments must be sequential within an account
  dependsOn: [gpt4oDeployment]
}

resource whisperDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openaiAccount
  name: 'whisper'
  sku: {
    name: 'Standard'
    capacity: 3 // 3 concurrent requests per minute
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'whisper'
      version: '001'
    }
  }
  dependsOn: [embeddingDeployment]
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output name string = openaiAccount.name
output endpoint string = openaiAccount.properties.endpoint
output principalId string = openaiAccount.identity.principalId
