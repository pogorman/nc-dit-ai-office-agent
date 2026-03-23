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
- **Secrets:** Azure Key Vault (RBAC mode) for Bing News Search API key
- **Agent:** Copilot Studio with custom connector to APIM
- **IaC:** Bicep (modular, under `/infra`)
- **Auth SDK:** `@azure/identity` DefaultAzureCredential, `openai` package with `getBearerTokenProvider`

## Key Patterns
- All Functions behind APIM — never expose directly
- Managed identity + DefaultAzureCredential everywhere — no keys in code
- Copilot Studio connects via Streamable HTTP through APIM custom connector
- Environment variables for all configuration (endpoints only, no secrets)
- Consumption/serverless tier for everything
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
    role-assignments.bicep      — All managed identity RBAC grants
    storage.bicep               — Blob Storage
/src
  /functions
    clips-ingest.ts             — Timer: Bing News → Cosmos DB (every 15 min)
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
```

## Known TODOs
- `.docx` extraction in remarks-ingest.ts (needs `mammoth` package)
- `.pdf` extraction in remarks-ingest.ts (needs `pdf-parse` package)
- AI Search index schemas not yet defined (Bicep provisions the service, not indexes)
- Daily digest email sending stubbed (needs Logic App or SendGrid integration)
- Function host key must be manually added to Key Vault after first deployment
