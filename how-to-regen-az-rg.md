# How to Restart Azure Resources (rg-nc-comms-agent-dev)

Resources were put to sleep on 2026-04-11 to stop idle costs. Cosmos DB, Blob Storage, Key Vault, Azure OpenAI, and APIM (Consumption) were left in place — they cost ~$0 at rest. The following were stopped or deleted.

## What was stopped

- **Function App** (`nc-comms-agent-dev-func`) — stopped via `az functionapp stop`
- **AI Search Basic** (`nc-comms-agent-dev-search`) — deleted (Basic tier can't be paused; ~$75/mo idle)
- **Private endpoint for Blob Storage** (`nc-comms-agent-dev-stor-pe`) — deleted (~$7.20/mo)
- **Private endpoint for Cosmos DB** (added via CLI, not in Bicep yet) — deleted if present (~$7.20/mo)

## ⚠️ Lessons from the 2026-05-15 resurrect

The original guide had three painful gaps. The procedure below is the corrected version. Key things that were NOT obvious:

1. **Storage account is `nccommsastordev`** — the original guide had a typo (`nccommsstordev`)
2. **`az deployment group create` will fail.** Three independent reasons:
   - VNet peering (`nc-to-philly`) blocks any address-space update on the VNet — Bicep tries to update it on every deploy
   - AI Search Basic in `eastus2` is often capacity-exhausted (`InsufficientResourcesAvailable`)
   - Cosmos `remarks-metadata` and `remarks-chunks` containers exist with different partition keys than Bicep declares
   - **Workaround:** skip Bicep entirely. Create AI Search and the PE via CLI (steps below).
3. **AI Search service URL is region-independent** (`{name}.search.windows.net` regardless of region). So if `eastus2` is out of capacity, deploy in `eastus` and **no app settings need updating**.
4. **AI Search RBAC must be re-granted** when the service is recreated — old role assignments are gone with the old resource. Grant `Search Index Data Reader` + `Search Index Data Contributor` to the Function App MI, and `Search Index Data Contributor` + `Search Service Contributor` to yourself for seeding.
5. **Cosmos firewall blocks seeding.** The original guide only mentioned flipping Storage public — Cosmos also needs your IP added to `ipRules` (or it returns 403 Forbidden even with `publicNetworkAccess: Enabled`).
6. **Blob private DNS A record points at the OLD PE IP.** The A record `nccommsastordev` in the cross-RG zone `rg-philly-profiteering/privatelink.blob.core.windows.net` was wired to the deleted PE's IP. After recreating the PE the IP changes — you must update the A record or the Function App can't load its deployment package, and **all functions return 404**.
7. **Function App needs `stop` + `start`, not `restart`** to reload the deployment package after a long sleep. `az functionapp restart` leaves the worker pointing at stale state.

## Steps to bring it back up

### 1. Restart the Function App

```bash
az functionapp start -n nc-comms-agent-dev-func -g rg-nc-comms-agent-dev
```

### 2. Recreate AI Search via CLI (skip Bicep)

`eastus2` is frequently out of Basic capacity. `eastus` works fine — Search URLs don't include the region, so no env-var changes are needed.

```bash
az search service create \
  --name nc-comms-agent-dev-search \
  --resource-group rg-nc-comms-agent-dev \
  --sku basic \
  --location eastus \
  --replica-count 1 \
  --partition-count 1 \
  --semantic-search standard \
  --identity-type SystemAssigned \
  --auth-options aadOrApiKey \
  --aad-auth-failure-mode http401WithBearerChallenge
```

### 3. Re-grant RBAC on the new AI Search

```bash
SEARCH_SCOPE="/subscriptions/5f88e6f4-a18f-4154-b55e-03165ed460b7/resourceGroups/rg-nc-comms-agent-dev/providers/Microsoft.Search/searchServices/nc-comms-agent-dev-search"
FUNC_MI="aeb18eb2-db18-42a2-9116-298e2a9f1443"

# Function App MI — read + write the indexes
az role assignment create --assignee $FUNC_MI --role "Search Index Data Reader"      --scope $SEARCH_SCOPE
az role assignment create --assignee $FUNC_MI --role "Search Index Data Contributor" --scope $SEARCH_SCOPE

# Yourself — needed to seed locally
ME=$(az ad signed-in-user show --query id -o tsv)
az role assignment create --assignee $ME --role "Search Index Data Contributor" --scope $SEARCH_SCOPE
az role assignment create --assignee $ME --role "Search Service Contributor"    --scope $SEARCH_SCOPE
```

### 4. Recreate the Blob Storage private endpoint

```bash
STOR_ID=$(az storage account show -n nccommsastordev -g rg-nc-comms-agent-dev --query id -o tsv)

az network private-endpoint create \
  -n nc-comms-agent-dev-stor-pe \
  -g rg-nc-comms-agent-dev \
  --vnet-name nc-comms-agent-dev-vnet \
  --subnet private-endpoints \
  --private-connection-resource-id $STOR_ID \
  --group-id blob \
  --connection-name nc-comms-agent-dev-stor-plsc
```

### 5. Update the Blob private DNS A record to the NEW PE IP

The blob private DNS zone lives cross-RG in `rg-philly-profiteering`. The existing A record points at the OLD (deleted) PE's IP. **Until you fix this, the Function App can't load its deployment package and every endpoint returns 404.**

```bash
NEW_PE_IP=$(az network private-endpoint show -n nc-comms-agent-dev-stor-pe -g rg-nc-comms-agent-dev --query "customDnsConfigs[0].ipAddresses[0]" -o tsv)
echo "New PE IP: $NEW_PE_IP"

# Find the OLD IP (returned by the next command)
az network private-dns record-set a show -g rg-philly-profiteering --zone-name privatelink.blob.core.windows.net -n nccommsastordev --query "aRecords[0].ipv4Address" -o tsv

# Replace it (substitute the IP from above into --ipv4-address):
az network private-dns record-set a remove-record -g rg-philly-profiteering --zone-name privatelink.blob.core.windows.net --record-set-name nccommsastordev --ipv4-address <OLD_IP>
az network private-dns record-set a add-record    -g rg-philly-profiteering --zone-name privatelink.blob.core.windows.net --record-set-name nccommsastordev --ipv4-address $NEW_PE_IP
```

### 6. Recreate the Cosmos DB private endpoint

```bash
COSMOS_ID=$(az cosmosdb show -n nc-comms-agent-dev-cosmos -g rg-nc-comms-agent-dev --query id -o tsv)

az network private-endpoint create \
  -n nc-comms-agent-dev-cosmos-pe \
  -g rg-nc-comms-agent-dev \
  --vnet-name nc-comms-agent-dev-vnet \
  --subnet private-endpoints \
  --private-connection-resource-id "$COSMOS_ID" \
  --group-id Sql \
  --connection-name nc-comms-agent-dev-cosmos-plsc
```

> ⚠️ In Git Bash on Windows, the `$COSMOS_ID` value (which starts with `/subscriptions/...`) gets path-mangled to `C:/Program Files/Git/subscriptions/...`. Run this in PowerShell, or quote the resource ID.

### 7. Open public access for seeding (Storage AND Cosmos)

```bash
# Storage: flip public access on
az storage account update -n nccommsastordev -g rg-nc-comms-agent-dev --public-network-access Enabled

# Storage: add your IP (defaultAction is Deny, so Enabled alone isn't enough)
MY_IP=$(curl -s https://api.ipify.org)
az storage account network-rule add -n nccommsastordev -g rg-nc-comms-agent-dev --ip-address $MY_IP

# Cosmos: add your IP (also necessary for seeding)
az cosmosdb update -n nc-comms-agent-dev-cosmos -g rg-nc-comms-agent-dev --ip-range-filter $MY_IP
```

### 8. Recreate AI Search indexes and reseed data

The seed scripts read several env vars. Set them all in your shell first.

```bash
export COSMOS_DB_ENDPOINT="https://nc-comms-agent-dev-cosmos.documents.azure.com:443/"
export AZURE_OPENAI_ENDPOINT="https://nc-comms-agent-dev-oai.openai.azure.com/"
export AZURE_AI_SEARCH_ENDPOINT="https://nc-comms-agent-dev-search.search.windows.net"

# Create indexes
npx tsx seed/create-search-indexes.ts

# Reseed clips (Cosmos → AI Search)
npx tsx seed/index-clips-to-search.ts

# Reseed remarks — load-remarks.ts takes ONE file at a time. Loop over them:
for f in seed/remarks/*.txt; do
  echo "=== $(basename $f) ==="
  npx tsx seed/load-remarks.ts "$f"
done
```

In PowerShell:

```powershell
$env:COSMOS_DB_ENDPOINT      = "https://nc-comms-agent-dev-cosmos.documents.azure.com:443/"
$env:AZURE_OPENAI_ENDPOINT   = "https://nc-comms-agent-dev-oai.openai.azure.com/"
$env:AZURE_AI_SEARCH_ENDPOINT = "https://nc-comms-agent-dev-search.search.windows.net"

npx tsx seed/create-search-indexes.ts
npx tsx seed/index-clips-to-search.ts

foreach ($f in Get-ChildItem seed/remarks/*.txt) {
  Write-Output "=== $($f.Name) ==="
  npx tsx seed/load-remarks.ts $f.FullName
}
```

### 9. Lock everything back down

```bash
# Storage: lock back down
az storage account network-rule remove -n nccommsastordev -g rg-nc-comms-agent-dev --ip-address $MY_IP
az storage account update -n nccommsastordev -g rg-nc-comms-agent-dev --public-network-access Disabled

# Cosmos: clear IP rule
COSMOS_ID=$(az cosmosdb show -n nc-comms-agent-dev-cosmos -g rg-nc-comms-agent-dev --query id -o tsv)
az resource update --ids $COSMOS_ID --set 'properties.ipRules=[]'
```

### 10. Hard-restart the Function App so it loads the deployment package

A soft `restart` is **not** enough after a long sleep — the worker stays pointing at stale state and every function 404s, even though `az functionapp function list` shows them all. Use stop + start:

```bash
az functionapp stop  -n nc-comms-agent-dev-func -g rg-nc-comms-agent-dev
sleep 15
az functionapp start -n nc-comms-agent-dev-func -g rg-nc-comms-agent-dev
sleep 60
```

### 11. Verify

Get the APIM master subscription key and hit a real endpoint:

```bash
APIM_KEY=$(az rest --method post \
  --uri "https://management.azure.com/subscriptions/5f88e6f4-a18f-4154-b55e-03165ed460b7/resourceGroups/rg-nc-comms-agent-dev/providers/Microsoft.ApiManagement/service/nc-comms-agent-dev-apim/subscriptions/master/listSecrets?api-version=2022-08-01" \
  --query primaryKey -o tsv)

curl -s -X POST "https://nc-comms-agent-dev-apim.azure-api.net/comms/clips/query" \
  -H "Ocp-Apim-Subscription-Key: $APIM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"education","top":3}' | jq '.clips | length'
```

If you get a number > 0, the agent is alive end-to-end (APIM → Function → AI Search → Cosmos).

Also useful:

```bash
# Check AI Search index doc counts
az search query --service-name nc-comms-agent-dev-search --index-name clips --search-text "*" --top 0 --include-total-count --query "@odata.count"
```

Expected: ~229 clips, ~43 remarks chunks (as of 2026-05-15).
