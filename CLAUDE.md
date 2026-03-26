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
- **Secrets:** Azure Key Vault (RBAC mode) — stores Function host key for APIM only (no external API keys needed)
- **Agent:** Copilot Studio with custom connector to APIM
- **Networking:** VNet with private endpoints for Blob Storage and Cosmos DB; Function App VNet integration
- **IaC:** Bicep (modular, under `/infra`)
- **Auth SDK:** `@azure/identity` DefaultAzureCredential, `openai` package with `getBearerTokenProvider`

## Key Patterns
- All Functions behind APIM — never expose directly
- Managed identity + DefaultAzureCredential everywhere — no keys in code
- Copilot Studio connects via Streamable HTTP through APIM custom connector
- Environment variables for all configuration (endpoints only, no secrets)
- Consumption/serverless tier for everything (except always-ready=1 on HTTP triggers to avoid cold starts)
- VNet + private endpoints for Blob Storage and Cosmos DB; Function App uses VNet integration (WEBSITE_CONTENTOVERVNET=1)
- Function timeout set to 10 minutes in host.json for ingestion workload
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
    networking.bicep             — VNet, subnets, private endpoint for blob, private DNS zone (Cosmos PE not yet added — CLI-only)
    role-assignments.bicep      — All managed identity RBAC grants
    storage.bicep               — Blob Storage (publicNetworkAccess: Disabled)
/src
  /functions
    clips-ingest.ts             — Timer: governor.nc.gov scrape → Cosmos DB + AI Search (7 AM ET daily) + HTTP POST: manual refresh
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
  /remarks                      — 7 seeded remarks (State of State + 6 monthly columns)
    2025-03-12_state-of-the-state_nc-general-assembly.txt
    2025-08-12_august-column-..._governors-office.txt
    2025-09-29_september-column-..._governors-office.txt
    2025-10-27_october-column-..._governors-office.txt
    2025-11-24_november-column-..._governors-office.txt
    2025-12-16_december-column-..._governors-office.txt
    2026-01-30_january-column-..._governors-office.txt
/docs
  build-demo-pptx.py            — Generates demo-questions.pptx (python-pptx)
  build-presentation-pptx.py    — Generates presentation.pptx (python-pptx)
  demo-questions.pptx           — Demo questions PowerPoint (6 clips, 7 remarks, 2 proofread samples)
  presentation.pptx             — 5-slide presentation PowerPoint
  /html                         — Printable HTML guides and presentation
    architecture-cheat-sheet.html
    how-it-works-guide.html
    demo.html                   — SPA demo UI (needs demo-server.js proxy)
    demo-questions.html         — Sample prompts for live demo (HTML version)
    presentation.html           — 5-slide demo deck (open in browser, F11 fullscreen)
    talk-track.html             — 1-page speaker guide with timing + demo moments
  /md                           — Markdown documentation
    ARCHITECTURE.md
    FAQ.md
    HOW-I-WAS-BUILT.md
    USER-GUIDE.md
    talk-track.md
  /pdf                          — PDF exports (empty, for printed handouts)
```

## Recent Changes (2026-03-26)
- **3-request split** — Presentation slide 2 now shows 3 separate customer requests (News Clips, Proofreading, Remarks) instead of combining clips + proofreading into one.
- **Demo questions created** — `docs/html/demo-questions.html` + `docs/demo-questions.pptx` with sample prompts for all 3 capabilities, mapped to seeded data.
- **Presentation PPTX** — `docs/presentation.pptx` generated from the HTML deck via `python-pptx`. Build script at `docs/build-presentation-pptx.py`.

## Changes (2026-03-24)
- **Clips dedup bug fixed** — `@azure/cosmos` v4 `ErrorResponse.code` is the string `"NotFound"`, not the number `404`. The dedup check in `clips-ingest.ts` was comparing with `!== 404`, so every new clip was treated as an error. Fix: check for both `404` and `"NotFound"`.
- **Clips schedule changed** — Timer moved from every 15 min to daily at 7 AM Eastern (`0 0 7 * * *`). `WEBSITE_TIME_ZONE=America/New_York` set on Function App so cron is DST-aware.
- **Manual refresh endpoint added** — `POST /api/clips/refresh` runs the same ingestion logic on demand, returns `{ successCount, errorCount, totalCount }`.
- **6 Governor's columns seeded** — Monthly columns (Aug 2025 – Jan 2026) scraped from governor.nc.gov and indexed into Cosmos DB + AI Search. Remarks index now has 7 documents / 26+ chunks.
- **Docs reorganized** — HTML guides, presentation, and talk track moved to `docs/html/`; markdown docs moved to `docs/md/`; `docs/pdf/` created for printed handouts.
- **Presentation + talk track created** — 5-slide HTML deck (`docs/html/presentation.html`) and 1-page speaker guide (`docs/html/talk-track.html`) for Thursday demo.
- **`.funcignore` created** — Excludes `.git`, `infra/`, `seed/`, `src/`, `*.ts`, `*.md` from deploy package.
- **Deploy process** — Storage and Cosmos DB `publicNetworkAccess` must be temporarily set to `Enabled` for local seeding/deploy, then set back to `Disabled`.

## Known TODOs
- Cosmos DB private endpoint was added via CLI — needs to be codified in `infra/modules/networking.bicep` (currently CLI-only)
- `.docx` extraction in remarks-ingest.ts (needs `mammoth` package)
- `.pdf` extraction in remarks-ingest.ts (needs `pdf-parse` package)
- Blob trigger for remarks-ingest not firing reliably on Flex Consumption (use `seed/load-remarks.ts` as workaround)
- Daily digest email sending stubbed (needs Logic App or SendGrid integration)
- Add `clips/refresh` route to APIM and custom connector so it's callable from Copilot Studio and the SPA through APIM
