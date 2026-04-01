# NC DIT AI Office Agent — Claude Code Instructions

## Project Overview
Serverless AI platform for NC Governor's Communications Office. Five capabilities:
1. **News Clips** — automated monitoring for Governor Stein mentions (timer-triggered ingestion + query)
2. **Remarks Search** — semantic search over historical speeches/remarks (blob-triggered ingestion + RAG query)
3. **Transcript Proofreading** — AI-powered cleanup of faulty transcripts (HTTP endpoint)
4. **Transcription** — audio/video transcription via Azure OpenAI Whisper (HTTP endpoint)
5. **Dashboard** — React SPA with operational visibility (stats, clips browser, remarks list, ingestion run history)

Agent experience delivered via **Microsoft Copilot Studio** (Teams / web). Dashboard delivered via React SPA.

## Tech Stack
- **Runtime:** TypeScript (strict mode) on Azure Functions v4 (Flex Consumption), Node.js 20
- **Gateway:** Azure API Management (Consumption tier)
- **Search:** Azure AI Search (Basic tier, hybrid vector + keyword)
- **AI:** Azure OpenAI (GPT-5-chat for synthesis/proofread, Whisper for transcription, text-embedding-3-large for vectors, Responses API with Bing grounding for multi-query web news search)
- **Dashboard:** React 19 + Vite 8 + Tailwind CSS v4 (TypeScript strict mode, types shared from `src/shared/types.ts` via `@shared` path alias)
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
    apim.bicep                  — API Management (Consumption) — includes dashboard GET + transcribe POST routes
    cosmos-db.bicep             — Cosmos DB (Serverless)
    function-app.bicep          — Function App (Flex Consumption) — WHISPER_DEPLOYMENT_NAME env var
    key-vault.bicep             — Key Vault (RBAC mode)
    openai.bicep                — Azure OpenAI + deployments (GPT-4o, GPT-5, GPT-5-chat, embeddings, Whisper)
    networking.bicep             — VNet, subnets, private endpoint for blob, private DNS zone (Cosmos PE not yet added — CLI-only)
    role-assignments.bicep      — All managed identity RBAC grants
    storage.bicep               — Blob Storage (publicNetworkAccess: Disabled)
/src
  /functions
    clips-ingest.ts             — Timer: gov scrape + 5 parallel web search queries (Bing grounding) → Cosmos DB + AI Search (7 AM ET daily, "past week") + HTTP POST: manual refresh ("past 6 months"). Persists IngestionRun to ingestion-state container.
    clips-query.ts              — HTTP POST: search/browse clips
    clips-digest.ts             — Timer: daily email digest (8 AM weekdays, stub)
    dashboard.ts                — 4 HTTP GET endpoints: /api/dashboard/{stats,clips,remarks,runs}
    remarks-ingest.ts           — Blob trigger: upload → chunk → embed → index
    remarks-query.ts            — HTTP POST: hybrid search → GPT-5-chat synthesis
    proofread.ts                — HTTP POST: transcript proofreading (fully implemented)
    transcribe.ts               — HTTP POST: audio/video transcription via Whisper (25MB max, multipart/form-data)
  /shared
    types.ts                    — All TypeScript interfaces (NewsClip, RemarksChunk, IngestionRun, DashboardStats, TranscribeResponse, etc.)
    openai-client.ts            — Azure OpenAI singleton + helpers + webSearch() via Responses API (search_context_size: "high") + transcribeAudio() via Whisper. Reasoning model support (gpt-5*, o*): max_completion_tokens, no temperature.
    search-client.ts            — AI Search factory + hybridSearch<T> helper
    cosmos-client.ts            — Cosmos DB singleton + getContainer helper
/connector                      — Power Platform custom connector for Copilot Studio
  apiDefinition.swagger.json    — OpenAPI 2.0 spec (4 actions: QueryClips, QueryRemarks, ProofreadTranscript, TranscribeFile)
  apiProperties.json            — Connector metadata (API key auth via APIM subscription key)
/seed                           — Data seeding & index creation tooling
  clips.json                    — Seed clips (initial batch; live index has 118 clips across 40+ outlets)
  clips-snapshot-2026-03-30.txt — Full snapshot of all 118 clips (title, date, outlet)
  dump-clips.ts                 — Script to dump all clips from Cosmos DB
  test-*.json                   — Model quality test results (GPT-4o and GPT-5-chat baselines)
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
/dashboard                      — React SPA dashboard
  src/
    App.tsx                     — Tab router (Overview, Clips, Remarks, Runs)
    components/                 — StatsPanel, ClipsFeed, RemarksList, RunsHistory, Layout
    api/                        — API client functions
    hooks/                      — Custom React hooks
  vite.config.ts                — Dev proxy to APIM or direct Function App; @shared path alias to src/shared/types.ts
  .env.example                  — VITE_APIM_BASE_URL, VITE_APIM_SUBSCRIPTION_KEY
  package.json                  — React 19, Vite 8, Tailwind CSS v4
/docs
  build-demo-pptx.py            — Generates demo-questions.pptx (python-pptx)
  build-presentation-pptx.py    — Generates presentation.pptx (python-pptx)
  demo-questions.pptx           — Demo questions PowerPoint (5 clips, 5 remarks, 2 proofread samples)
  presentation.pptx             — 8-slide presentation PowerPoint (5 capability + 3 diagram slides)
  /html                         — Printable HTML guides and presentation
    architecture-cheat-sheet.html
    how-it-works-guide.html
    demo.html                   — SPA demo UI (needs demo-server.js proxy)
    demo-questions.html         — Sample prompts for live demo (HTML version)
    presentation.html           — 5-slide demo deck (open in browser, F11 fullscreen)
    talk-track.html             — 1-page speaker guide with timing + demo moments
    video-processing-functionality.html — Video/audio transcription feature explainer
    azure-technical-reference.html — Comprehensive Azure technical reference (resource inventory, Bicep, Functions, auth, data architecture, RBAC, deployment checklist, appendices)
  /md                           — Markdown documentation
    ARCHITECTURE.md
    FAQ.md
    HOW-I-WAS-BUILT.md
    USER-GUIDE.md
    talk-track.md
  /pdf                          — PDF exports (empty, for printed handouts)
  model-quality-comparison.html — 4-column comparison: GPT-4o vs GPT-5-chat vs Copilot Studio generative vs classic
/inbox                          — Customer meeting notes and Copilot Studio test results
  nc-gov-meeting-notes.txt      — 2026-03-26 customer meeting notes with follow-ups
  scoring-for-generative-w-4o-gcc.txt — Copilot Studio generative orchestration test results
  3-classic-orchestration-clips-questions.txt — Classic orchestration clips test results
  3-remarks-classic-orchestration.txt — Classic orchestration remarks test results
```

## Recent Changes (2026-04-01)
- **Azure Technical Reference** — New comprehensive HTML document at `docs/html/azure-technical-reference.html`. Covers: resource inventory, all 8 Bicep modules, deep dives on all 8 Functions, shared module singletons and auth patterns, Cosmos containers and AI Search index schemas, identity/security model, APIM routing, Copilot Studio integration, dashboard SPA, cost profile. Includes 6 appendices: environment variables, RBAC role matrix, API endpoints, deployment checklist, seed scripts, file-by-file inventory.
- **Docs updated** — README, FAQ, HOW-I-WAS-BUILT (Chapter 21), and CLAUDE.md updated to reference the new technical reference.

## Changes (2026-03-30)
- **GPT-5-chat deployed** — New `gpt-5-chat` (2025-10-03, GlobalStandard) and `gpt-5` (2025-08-07, GlobalStandard) deployments added to Azure OpenAI. Backend switched from GPT-4o to GPT-5-chat via `GPT4O_DEPLOYMENT_NAME` app setting. Richer synthesis: markdown tables, deeper quote analysis, evolution tracking.
- **Reasoning model support** — `openai-client.ts` now detects reasoning models (`gpt-5*`, `o*`) and automatically uses `max_completion_tokens` instead of `max_tokens`, drops `temperature`, and bumps default token budget to 16384. Remarks synthesis bumped from 1500 to 8192 max tokens to accommodate reasoning overhead.
- **Transcribe route added to connector** — `apiDefinition.swagger.json` now has 4 operations: QueryClips, QueryRemarks, ProofreadTranscript, TranscribeFile. Connector updated in Power Platform via `pac connector update`.
- **Model quality comparison testing** — Ran 7 test questions across 4 configurations (Raw API GPT-4o, Raw API GPT-5-chat, Copilot Studio Generative, Copilot Studio Classic). Results saved in `seed/test-*.json` and `inbox/`. Final comparison doc at `docs/model-quality-comparison.html`.
- **118 clips across 40+ outlets** — Clips index grown from 78/29 to 118/40+. Full snapshot at `seed/clips-snapshot-2026-03-30.txt`.
- **dump-clips.ts** — New script to dump all clips from Cosmos DB (`npx tsx seed/dump-clips.ts`).
- **APIM transcribe route fixed** — Git Bash path expansion corrupted the URL template to `/C:/Program Files/Git/transcribe`. Fixed via REST API PUT.
- **Onsite meetings Apr 1-2** — Customer meeting notes in `inbox/nc-gov-meeting-notes.txt`. Open items: model upgrade feasibility in Copilot Studio GCC, database separation (press releases vs external news).

## Changes (2026-03-26 evening)
- **React Dashboard** — New `/dashboard` directory with React 19 + Vite 8 + Tailwind CSS v4. Four tabs: Overview (stat cards, outlet breakdown bars, latest run status with auto-refresh), Clips (paginated list with outlet/date filters), Remarks (document table), Runs (ingestion run history with status badges). Types shared from `src/shared/types.ts` via `@shared` path alias in `vite.config.ts`. No routing library, no state management library, no charting library.
- **4 dashboard GET endpoints** — New `src/functions/dashboard.ts` with `GET /api/dashboard/stats`, `GET /api/dashboard/clips` (paginated, outlet/date filters), `GET /api/dashboard/remarks`, `GET /api/dashboard/runs`. All read from Cosmos DB.
- **Transcribe capability** — New `src/functions/transcribe.ts` with `POST /api/transcribe`. Accepts multipart/form-data file upload (mp3, mp4, wav, webm, etc., 25MB max). Uses Azure OpenAI Whisper via `transcribeAudio()` helper in `openai-client.ts`. Optional `language` field for ISO 639-1 hint.
- **Run logging** — Each clips ingestion (timer + manual) persists an `IngestionRun` document to the `ingestion-state` Cosmos container with trigger type, timing, counts, sources, and status.
- **New types** — `IngestionRun`, `DashboardStats`, `TranscribeResponse` interfaces in `src/shared/types.ts`.
- **APIM routes expanded** — 4 dashboard GET operations + 1 transcribe POST operation added to `apim.bicep`.
- **WHISPER_DEPLOYMENT_NAME** — New env var added to `function-app.bicep`.
- **78 clips across 29 outlets** — Clips index grown from 58/21 to 78/29.
- **`.funcignore` updated** — `dashboard` directory excluded from deploy package.

## Changes (2026-03-26 morning)
- **Multi-query web search** — Replaced single web search query with `webSearchQueries()` function that generates 5 focused queries (general coverage, budget/education, Helene recovery, Medicaid/healthcare, law enforcement/economy). All 5 run in parallel. Each returns ~8-12 URLs; combined: ~30-40 unique external URLs per run. Cost: ~$0.175/day ($5/month).
- **`search_context_size: "high"`** — Set on the `web_search` tool to get more citations per query.
- **Timeframe split** — Daily 7 AM timer uses "past week" (focused on new coverage). Manual `POST /api/clips/refresh` uses "past 6 months" (for backfill). `webSearchQueries()` takes a timeframe parameter.
- **Web news search via Azure OpenAI Responses API with Bing grounding** — `clips-ingest.ts` has a second source: `fetchWebNewsListings()` calls the Responses API `web_search` tool to find external news. Gov scraper + web search run in parallel via `Promise.all`, merged with URL-hash dedup. No new Azure resource needed — uses existing Azure OpenAI resource's built-in Bing grounding with managed identity auth.
- **`openai-client.ts` `webSearch()` helper** — Uses the `OpenAI` class (not `AzureOpenAI`) with `/openai/v1/` base URL for the Responses API. Extracts URL citations from response annotations. Exports `WebSearchResult` interface.
- **Outlet name extraction** — `outletFromUrl()` maps hostnames to friendly names (wral.com -> "WRAL", newsobserver.com -> "News & Observer", etc.).
- **Cosmos SDK v4 dedup rewrite** — `.read()` returns `statusCode: 404` instead of throwing. Changed dedup check to `statusCode === 200 && existingClip` instead of try/catch.
- **Refresh endpoint enhanced** — Now returns `newCount`, `skippedCount`, and `sources: { gov, web }` breakdown.
- **`.funcignore` expanded** — Added `docs` and `connector` to reduce deploy archive size (1.4GB -> 145MB with `npm ci --omit=dev`).
- **Always-ready instances in Bicep** — Added `alwaysReady: [{ name: 'http', instanceCount: 1 }]` to `scaleAndConcurrency` in `function-app.bicep`. Fixes cold start timeout (240s ConnectorTimeoutError on first Copilot Studio call).
- **Presentation expanded to 8 slides** — Added 3 diagram slides: Architecture Overview (service topology), Request Flow (swim lanes per capability), Data Flow (ingestion + query paths). Build script: `docs/build-presentation-pptx.py`.
- **Demo questions trimmed & verified** — 5 clips, 5 remarks, 2 proofread samples. Every question verified against actual seeded data. Removed questions that didn't produce results ("rural internet access" had no matching clips, etc.). Build script: `docs/build-demo-pptx.py`.
- **3-request split** — Presentation slide 2 now shows 3 separate customer requests (News Clips, Proofreading, Remarks) instead of combining clips + proofreading into one.

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
- Add `clips/refresh` route to custom connector (transcribe already added 2026-03-30)
- Dashboard production build + hosting (currently dev-only via `npm run dev`)
- Database separation: split press releases (governor.nc.gov) from external news into separate Cosmos containers/indexes (customer request)
- Copilot Studio GCC model upgrade: GPT-4.0 orchestrator limits response quality — escalation path via state officials to Microsoft product team
- GPT-5/GPT-5-chat deployments added manually — need to codify in `infra/modules/openai.bicep`
- Transcribe file upload in Copilot Studio: generative orchestration file mapping needs Activity.Attachments wiring; classic needs Ask a Question (File type) node

## Key Patterns — Web Search
- `webSearch()` in `openai-client.ts` uses the `OpenAI` class (not `AzureOpenAI`) with `baseURL: ${endpoint}/openai/v1/` — the Responses API requires this path
- `search_context_size: "high"` on the `web_search` tool for more citations per query
- Auth: `getBearerTokenProvider` with `cognitiveservices.azure.com/.default` scope, token passed as `apiKey`
- URL citations are extracted from `response.output[].content[].annotations[]` where `type === "url_citation"`
- `webSearchQueries(timeframe)` generates 5 focused queries: general, budget/education, Helene recovery, Medicaid/healthcare, law enforcement/economy
- All 5 queries run in parallel via `Promise.all` in `fetchWebNewsListings()`; results merged and deduped
- Daily timer passes "past week"; manual refresh passes "past 6 months"
- Gov results are excluded from web search results (`governor.nc.gov` URLs filtered) since the gov scraper already covers those
- `outletFromUrl()` maps hostnames to friendly outlet names via a static `domainMap` Record
- Cost: ~$0.175/day (5 x $0.035/call) = ~$5/month
