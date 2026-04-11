# How to Restart Azure Resources (rg-nc-comms-agent-dev)

Resources were put to sleep on 2026-04-11 to stop idle costs. Cosmos DB, Blob Storage, Key Vault, Azure OpenAI, and APIM (Consumption) were left in place — they cost ~$0 at rest. The following were stopped or deleted.

## What was stopped

- **Function App** (`nc-comms-agent-dev-func`) — stopped via `az functionapp stop`
- **AI Search Basic** (`nc-comms-agent-dev-search`) — deleted (Basic tier can't be paused; ~$75/mo idle)
- **Private endpoint for Blob Storage** (`nc-comms-agent-dev-stor-pe`) — deleted (~$7.20/mo)
- **Private endpoint for Cosmos DB** (added via CLI, not in Bicep) — deleted if present (~$7.20/mo)

## Steps to bring it back up

### 1. Restart the Function App

```bash
az functionapp start -n nc-comms-agent-dev-func -g rg-nc-comms-agent-dev
```

### 2. Redeploy AI Search + networking from Bicep

```bash
az deployment group create \
  -g rg-nc-comms-agent-dev \
  -f infra/main.bicep \
  -p infra/main.bicepparam
```

This recreates AI Search (Basic), the Blob Storage private endpoint, DNS zones, and all role assignments. Review the deployment output for errors — role assignments may warn if they already exist (safe to ignore).

### 3. Recreate the Cosmos DB private endpoint (CLI-only, not in Bicep yet)

```bash
# Get Cosmos account ID
COSMOS_ID=$(az cosmosdb show -n nc-comms-agent-dev-cosmos -g rg-nc-comms-agent-dev --query id -o tsv)

# Get private-endpoints subnet ID
SUBNET_ID=$(az network vnet subnet show \
  --vnet-name nc-comms-agent-dev-vnet \
  -g rg-nc-comms-agent-dev \
  -n private-endpoints \
  --query id -o tsv)

az network private-endpoint create \
  -n nc-comms-agent-dev-cosmos-pe \
  -g rg-nc-comms-agent-dev \
  --vnet-name nc-comms-agent-dev-vnet \
  --subnet private-endpoints \
  --private-connection-resource-id $COSMOS_ID \
  --group-id Sql \
  --connection-name nc-comms-agent-dev-cosmos-plsc
```

### 4. Flip Storage to public temporarily (for seeding)

```bash
az storage account update -n nccommsstordev -g rg-nc-comms-agent-dev --public-network-access Enabled
```

### 5. Recreate AI Search indexes and reseed data

```bash
# Create the indexes (clips + remarks)
npx tsx seed/create-search-indexes.ts

# Reseed clips from Cosmos → AI Search
npx tsx seed/index-clips-to-search.ts

# Reseed remarks (chunks, embeds, indexes)
npx tsx seed/load-remarks.ts
```

All source data (clips, remarks metadata, remark documents) is still in Cosmos DB and Blob Storage — these scripts rebuild the search indexes from that data.

### 6. Flip Storage back to private

```bash
az storage account update -n nccommsstordev -g rg-nc-comms-agent-dev --public-network-access Disabled
```

### 7. Verify

- Hit the APIM gateway URL to confirm Functions respond
- Check AI Search indexes have document counts (`az search query --service-name nc-comms-agent-dev-search ...`)
- Test a Copilot Studio query end-to-end
