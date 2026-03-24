# NC DIT AI Office Agent — Claude Code Instructions

## Project Overview
Serverless AI platform for NC Governor's Communications Office. Three capabilities:
1. **News Clips** — automated monitoring for Governor Stein mentions (timer-triggered ingestion + query)
2. **Remarks Search** — semantic search over historical speeches/remarks (blob-triggered ingestion + RAG query)
3. **Transcript Proofreading** — AI-powered cleanup of faulty transcripts (HTTP endpoint)

Agent experience delivered via **Microsoft Copilot Studio** (Teams / web).

## Tech Stack
- **Runtime:** TypeScript (strict mode) on Azure Functions v4 (Flex Consumption), Node.js 20
- **Gateway:** Azure API Management (Consumption tier)
- **Search:** Azure AI Search (Basic tier, hybrid vector + keyword)
- **AI:** Azure OpenAI (GPT-4o for synthesis/proofread, text-embedding-3-large for vectors)
- **Storage:** Cosmos DB (serverless) for clips + remarks metadata, Blob Storage for remarks doc uploads
- **Secrets:** Azure Key Vault (RBAC mode)
- **Agent:** Copilot Studio with custom connector to APIM
- **Networking:** VNet with private endpoint for blob storage; Function App VNet integration
- **IaC:** Bicep (modular, under `/infra`)
- **Auth SDK:** `@azure/identity` DefaultAzureCredential, `openai` package with `getBearerTokenProvider`

## Key Patterns
- All Functions behind APIM — never expose directly
- Managed identity + DefaultAzureCredential everywhere — no keys in code
- Copilot Studio connects via Streamable HTTP through APIM custom connector
- Environment variables for all configuration (endpoints only, no secrets)
- Consumption/serverless tier for everything (except always-ready=1 on HTTP triggers to avoid cold starts)
- VNet + private endpoint for blob storage; Function App uses VNet integration (WEBSITE_CONTENTOVERVNET=1)
- Singleton pattern for OpenAI, Cosmos, and Search clients in shared modules
- Index signature `[key: string]: unknown` on types used with AI Search generics
- Cosmos DB uses its own native RBAC (`sqlRoleAssignments`), not ARM role assignments

## Directory Structure
```
/infra                          — Bicep IaC
  main.bicep                    — Orchestrator
  main.bicepparam               — Dev environment parameters
  /modules
    ai-search.bicep             — Azure AI Search (Basic)
    apim.bicep                  — API Management (Consumption)
    cosmos-db.bicep             — Cosmos DB (Serverless)
    function-app.bicep          — Function App (Flex Consumption)
    key-vault.bicep             — Key Vault (RBAC mode)
    openai.bicep                — Azure OpenAI + deployments
    networking.bicep             — VNet, subnets, private endpoint for blob, private DNS zone
    role-assignments.bicep      — All managed identity RBAC grants
    storage.bicep               — Blob Storage (publicNetworkAccess: Disabled)
/src
  /functions
    clips-ingest.ts             — Timer: governor.nc.gov scrape → Cosmos DB + AI Search (every 15 min)
    clips-query.ts              — HTTP POST: search/browse clips
    clips-digest.ts             — Timer: daily email digest (8 AM weekdays, stub)
    remarks-ingest.ts           — Blob trigger: upload → chunk → embed → index
    remarks-query.ts            — HTTP POST: hybrid search → GPT-4o synthesis
    proofread.ts                — HTTP POST: transcript proofreading (fully implemented)
  /shared
    types.ts                    — All TypeScript interfaces (NewsClip, RemarksChunk, etc.)
    openai-client.ts            — Azure OpenAI singleton + helpers
    search-client.ts            — AI Search factory + hybridSearch<T> helper
    cosmos-client.ts            — Cosmos DB singleton + getContainer helper
/connector                      — Power Platform custom connector for Copilot Studio
  apiDefinition.swagger.json    — OpenAPI 2.0 spec (3 actions: QueryClips, QueryRemarks, ProofreadTranscript)
  apiProperties.json            — Connector metadata (API key auth via APIM subscription key)
/seed                           — Data seeding & index creation tooling
  clips.json                    — 10 real Governor Stein clips (March 2026 press releases)
  load-clips.ts                 — Loads clips into Cosmos DB with embeddings
  create-search-indexes.ts      — Creates both AI Search indexes (clips + remarks)
  index-clips-to-search.ts      — Pushes clips from Cosmos to AI Search
  load-remarks.ts               — Chunks, embeds, and indexes remarks into Cosmos + AI Search
  /remarks
    2025-03-12_state-of-the-state_nc-general-assembly.txt
```

## Known TODOs
- `.docx` extraction in remarks-ingest.ts (needs `mammoth` package)
- `.pdf` extraction in remarks-ingest.ts (needs `pdf-parse` package)
- Blob trigger for remarks-ingest not firing reliably on Flex Consumption (use `seed/load-remarks.ts` as workaround)
- Daily digest email sending stubbed (needs Logic App or SendGrid integration)
- SPA (demo.html + demo-server.js) needs updating to match current API surface
