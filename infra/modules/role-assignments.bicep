// ============================================================================
// role-assignments.bicep — Managed identity role assignments
//
// Grants the Function App's system-assigned managed identity the minimum
// permissions needed to interact with each backing service.
// ============================================================================

@description('Principal ID of the Function App managed identity')
param functionAppPrincipalId string

@description('Principal ID of the APIM managed identity')
param apimPrincipalId string

@description('Name of the Azure OpenAI account')
param openaiAccountName string

@description('Name of the Azure AI Search service')
param aiSearchName string

@description('Name of the Cosmos DB account')
param cosmosDbAccountName string

@description('Name of the Storage account')
param storageAccountName string

@description('Name of the Key Vault')
param keyVaultName string

// ---------------------------------------------------------------------------
// Reference existing resources
// ---------------------------------------------------------------------------

resource openaiAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: openaiAccountName
}

resource searchService 'Microsoft.Search/searchServices@2024-06-01-preview' existing = {
  name: aiSearchName
}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' existing = {
  name: cosmosDbAccountName
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

// ---------------------------------------------------------------------------
// Built-in Role Definitions
// ---------------------------------------------------------------------------

// Cognitive Services OpenAI User — invoke OpenAI models
var cognitiveServicesOpenAIUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

// Search Index Data Reader — read search index content
var searchIndexDataReaderRoleId = '1407120a-92aa-4202-b7e9-c0e197c71c8f'

// Search Index Data Contributor — read/write search index content
var searchIndexDataContributorRoleId = '8ebe5a00-799e-43f5-93ac-243d3dce84a7'

// Cosmos DB Built-in Data Contributor — read/write Cosmos DB data
// NOTE: This is the Cosmos DB RBAC data plane role, assigned at the account scope
var cosmosDbDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

// Storage Blob Data Reader — read blob content
var storageBlobDataReaderRoleId = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'

// Key Vault Secrets User — read secrets
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

// ---------------------------------------------------------------------------
// Role Assignments — Function App → Azure OpenAI
// ---------------------------------------------------------------------------

resource openaiRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openaiAccount.id, functionAppPrincipalId, cognitiveServicesOpenAIUserRoleId)
  scope: openaiAccount
  properties: {
    principalId: functionAppPrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesOpenAIUserRoleId)
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Role Assignments — Function App → AI Search (Reader + Contributor)
// ---------------------------------------------------------------------------

resource searchReaderRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(searchService.id, functionAppPrincipalId, searchIndexDataReaderRoleId)
  scope: searchService
  properties: {
    principalId: functionAppPrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', searchIndexDataReaderRoleId)
    principalType: 'ServicePrincipal'
  }
}

resource searchContributorRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(searchService.id, functionAppPrincipalId, searchIndexDataContributorRoleId)
  scope: searchService
  properties: {
    principalId: functionAppPrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', searchIndexDataContributorRoleId)
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Role Assignments — Function App → Cosmos DB
//
// Cosmos DB uses its own RBAC system for data-plane access. The built-in
// "Cosmos DB Built-in Data Contributor" role is assigned via the
// sqlRoleAssignment resource type, not the generic ARM roleAssignment.
// ---------------------------------------------------------------------------

resource cosmosDbRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, functionAppPrincipalId, cosmosDbDataContributorRoleId)
  properties: {
    principalId: functionAppPrincipalId
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/${cosmosDbDataContributorRoleId}'
    scope: cosmosAccount.id
  }
}

// ---------------------------------------------------------------------------
// Role Assignments — Function App → Storage
// ---------------------------------------------------------------------------

resource storageRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionAppPrincipalId, storageBlobDataReaderRoleId)
  scope: storageAccount
  properties: {
    principalId: functionAppPrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataReaderRoleId)
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Role Assignments — Function App → Key Vault
// ---------------------------------------------------------------------------

resource keyVaultRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionAppPrincipalId, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: functionAppPrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Role Assignments — APIM → Key Vault (to read Function host key)
// ---------------------------------------------------------------------------

resource apimKeyVaultRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, apimPrincipalId, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: apimPrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalType: 'ServicePrincipal'
  }
}
