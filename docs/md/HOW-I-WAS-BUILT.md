# How I Was Built — NC DIT AI Office Agent

An ELI5 walkthrough of how this project was designed and built, documenting the prompts, decisions, and results along the way.

---

## Chapter 1: The Ask

**Date:** 2026-03-23

The NC DIT AI Office came to us with three needs for the Governor's Communications team:

1. **News Clips** — "How could we automate the process of identifying mentions of Governor Stein in the news and collecting the outlet, title, first paragraph, and first mention of Governor Stein in the article?"

2. **Proofreading** — "Is there a way to use AI for proofreading of faulty transcripts?"

3. **Remarks Search** — "How could we create a useful search + retrieval function for existing language on a given topic? For example, what is the language we've used to talk about clean tech across a variety of remarks?"

### Design Decisions

- **Copilot Studio for the agent experience** — The customer's staff already lives in Teams. Copilot Studio gives us a managed conversational UI with Entra ID SSO, Adaptive Cards, and no custom frontend to maintain.
- **Serverless-first** — This is a low-traffic internal tool. Consumption-tier everything keeps costs under $200/month.
- **RAG for remarks** — Classic retrieval-augmented generation pattern. Chunk the speeches, embed them, hybrid search, synthesize with GPT-4o. The key insight: always return direct quotes with citations so staff can trust the output.
- **Transcript proofreading as Phase 1** — Simplest capability, proves the entire pipeline (Copilot Studio → APIM → Function → Azure OpenAI) end-to-end.

### Architecture Prompt

> "Build a serverless AI platform for the NC Governor's Communications Office. Two capabilities: automated news clip monitoring for Governor Stein mentions, and semantic search over historical remarks. Agent experience via Copilot Studio in Teams. All Azure, managed identity everywhere, consumption tier."

This produced the architecture documented in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Chapter 2: Scaffolding the Full Stack

**Date:** 2026-03-23

With the architecture locked, we scaffolded everything in one pass using three parallel workstreams:

### Workstream 1: Bicep Infrastructure
Created 10 files under `/infra` — a main orchestrator and 8 resource modules. Key decisions:
- **Key Vault uses RBAC mode** (not access policies) — avoids a circular dependency where Key Vault would need the Function App's principal ID at creation time, but the Function App doesn't exist yet
- **Cosmos DB native RBAC** — Cosmos DB data-plane access requires its own `sqlRoleAssignments` resource type, not the standard ARM `roleAssignments`. This is a common gotcha.
- **No secrets in app settings** — every Function App setting is an endpoint URL. Originally the Bing API key was stored in Key Vault, but clips ingestion was later rewritten to scrape governor.nc.gov directly (see Chapter 8), eliminating the need for external API keys entirely.
- **Post-deploy manual step** — the Function host key has to be copied into Key Vault after the first deployment so APIM can inject it

### Workstream 2: Function App Core + Proofread
Created the TypeScript project scaffold (package.json, tsconfig.json, host.json), shared utility modules (OpenAI, AI Search, Cosmos singletons), and the transcript proofread function as a fully working Phase 1 deliverable.

Key pattern: `AzureOpenAI` is imported from the `openai` package (not `@azure/openai`), using `getBearerTokenProvider` from `@azure/identity` for managed identity auth. This is the current recommended pattern from Microsoft's SDK docs.

### Workstream 3: Clips + Remarks Functions
Built all five remaining functions:
- `clips-ingest.ts` — Timer-triggered press release scraping with SHA-256 dedup (originally Bing News Search, later rewritten to scrape governor.nc.gov directly — see Chapter 8)
- `clips-query.ts` — Hybrid search with a "latest" mode fallback
- `clips-digest.ts` — Daily digest HTML generation (email sending stubbed)
- `remarks-ingest.ts` — Blob-triggered chunking pipeline with paragraph-aware splitting
- `remarks-query.ts` — Hybrid search + GPT-4o synthesis with citation formatting

### Reconciliation
The three workstreams ran in parallel, which caused a few type mismatches:
- Functions referenced `embedding` fields not on the original interfaces → added `embedding?: number[]` and index signatures to `NewsClip` and `RemarksChunk`
- `RemarksMetadata` needed `id`, `sourceFile`, `chunkCount`, `ingestedAt` fields used by the ingestion function
- `@azure/keyvault-secrets` was used by clips-ingest but wasn't in the original package.json → installed it

After fixes: **clean TypeScript compile, strict mode, zero errors**.

### What We Ended Up With
- 10 Bicep files (infra)
- 6 Azure Functions (4 HTTP/timer triggers, 1 blob trigger, 1 timer digest)
- 4 shared utility modules
- All auth via managed identity
- Total: 33 source files, compiling cleanly

---

## Chapter 3: Deployment, Seeding, and End-to-End Testing

**Date:** 2026-03-23

With the code compiling cleanly, the next step was deploying to Azure, seeding real data, and validating all three capabilities end-to-end.

### Deploying to Azure

Deployed all Bicep infrastructure to resource group `rg-nc-comms-agent-dev`. 8 Azure resources provisioned:
- Function App (Flex Consumption, Linux, Node.js 20)
- APIM (Consumption tier)
- AI Search (Basic)
- Azure OpenAI (GPT-4o + text-embedding-3-large deployments)
- Cosmos DB (Serverless, 4 containers: `clips`, `ingestion-state`, `remarks-chunks`, `remarks-metadata`)
- Storage Account (`remarks-uploads` + `deployments` containers)
- Key Vault (RBAC mode)

All managed identity role assignments were applied. Function App deployed with 6 registered functions (3 HTTP, 2 timer, 1 blob).

### Building the Seed Tooling

AI Search indexes can't be defined in Bicep (Bicep provisions the service, not the indexes). We built a `seed/` directory with standalone TypeScript scripts that run via `npx tsx`:

1. **`create-search-indexes.ts`** — Creates both AI Search indexes programmatically. The clips index has 11 fields and the remarks index has 10 fields. Both use HNSW vector search profiles (1536-dimension vectors for text-embedding-3-large) and semantic search configurations.

2. **`clips.json` + `load-clips.ts`** — 10 real Governor Stein clips sourced from March 2026 press releases. The load script generates embeddings via Azure OpenAI, writes to Cosmos DB, and stores the embedding vectors. Full article text was extracted from source URLs using Mozilla Readability (the `@mozilla/readability` + `jsdom` packages).

3. **`index-clips-to-search.ts`** — Reads clips from Cosmos DB and pushes them into the AI Search clips index. Separated from the Cosmos load step so each can be re-run independently.

4. **`load-remarks.ts`** — Takes `.txt` files from `seed/remarks/`, chunks them into ~500-word paragraphs, generates embeddings, and loads into both Cosmos DB (`remarks-chunks` + `remarks-metadata` containers) and the AI Search remarks index. The 2025 State of the State address was seeded as the first remark (17 chunks).

### Testing All Three Capabilities

**Transcript Proofread (POST /api/proofread):** Sent a garbled transcript through APIM. GPT-4o returned structured JSON with corrected text, a list of changes, and confidence levels. Fully working.

**Clips Query (POST /api/clips/query):** Tested both modes:
- `"mode": "latest"` — browses Cosmos DB, returns recent clips sorted by date
- `"mode": "search", "query": "clean energy"` — hybrid vector + keyword search via AI Search, returns relevant clips with scores

Both modes working with the 10 seeded clips.

**Remarks Query (POST /api/remarks/query):** Sent `"query": "education"` and received a GPT-4o-synthesized response with direct quotes from the State of the State address, complete with citations (date, event name). The hybrid search correctly retrieved relevant chunks from the 17 indexed.

### Issues Discovered

- **Blob trigger not firing:** The remarks-ingest blob trigger doesn't fire reliably on Flex Consumption. This is a known limitation with Flex Consumption + blob triggers. Workaround: use `seed/load-remarks.ts` directly.
- **APIM function key:** The placeholder key in APIM needs to be replaced with the real Function host key from Key Vault after deployment. This is a manual step.

### Result

All 3 capabilities tested and working end-to-end through APIM. The platform is ready for Copilot Studio integration (Phase 4).

---

## Chapter 4: Custom Connector & APIM Fixes

**Date:** 2026-03-23

With all three backend capabilities tested and working, the next step was bridging Copilot Studio to the APIM gateway via a Power Platform custom connector.

### APIM Fixes

Two issues were discovered and resolved:

1. **Service URL missing `/api` suffix** — The APIM backend service URL was pointing to the Function App root, but Azure Functions uses `/api` as the default route prefix. Routes like `/clips/query` were resolving to the Function App as `/clips/query` instead of `/api/clips/query`. Fixed by updating the APIM service URL to include the `/api` suffix.

2. **Function host key placeholder** — The APIM named value `function-host-key` was a placeholder from the Bicep deployment. Replaced it with the actual Function App host key so APIM can authenticate to the Functions backend.

After these fixes, all three APIM endpoints were verified working:
- `POST https://nc-comms-agent-dev-apim.azure-api.net/comms/clips/query`
- `POST https://nc-comms-agent-dev-apim.azure-api.net/comms/remarks/query`
- `POST https://nc-comms-agent-dev-apim.azure-api.net/comms/proofread`

### Building the Custom Connector

Created a Power Platform custom connector in `/connector/` with two files:

1. **`apiDefinition.swagger.json`** — OpenAPI 2.0 spec defining three operations:
   - **QueryClips** (`POST /clips/query`) — search or browse news clips with optional date filters
   - **QueryRemarks** (`POST /remarks/query`) — semantic search over remarks with RAG synthesis toggle
   - **ProofreadTranscript** (`POST /proofread`) — AI-powered transcript cleanup

   The spec includes full request/response schemas matching the Function signatures, so Copilot Studio can auto-generate input forms and parse responses.

2. **`apiProperties.json`** — Connector metadata with API key auth. The connection parameter prompts for the APIM subscription key (`Ocp-Apim-Subscription-Key` header), which gets injected into every request.

### Deploying to GCC

The connector was deployed to the GCC (Government Community Cloud) Power Platform environment (`og-ai`). GCC is required because this is a state government workload. The deployment was done through the Power Platform maker portal — import the two JSON files as a custom connector, configure the connection with the APIM subscription key, and test each action.

### What's Next

The custom connector is live. The next step is configuring the Copilot Studio agent:
- Create topics for each capability (Clips Browse, Clips Search, Remarks Search, Transcript Proofread)
- Map trigger phrases to connector actions
- Format responses with Adaptive Cards
- Configure Generative Answers fallback grounded on both search indexes

---

## Chapter 5: Copilot Studio Agent — Generative Orchestration

**Date:** 2026-03-24

With the custom connector deployed, the next step was configuring the Copilot Studio agent. Originally we planned to build manual topics for each capability (Clips Browse, Clips Search, Remarks Search, Transcript Proofread) with explicit trigger phrases.

### The Discovery

Copilot Studio now supports **generative orchestration** — the orchestrator reads the OpenAPI operation descriptions from the custom connector and automatically selects the right tool based on user intent. No manual topic configuration needed at all. The quality of the OpenAPI operation `description` and `summary` fields in the connector spec drives tool selection accuracy.

### Result

All three tools — QueryClips, QueryRemarks, and ProofreadTranscript — are working in the GCC `og-ai` environment. The agent correctly routes:
- "Show me today's clips" → QueryClips
- "What language have we used on education?" → QueryRemarks
- "Proofread this transcript" → ProofreadTranscript

This was a significant simplification. Instead of building and maintaining 5-6 topic definitions with trigger phrases and response formatting, the generative orchestrator handles everything from the OpenAPI spec descriptions.

---

## Chapter 6: VNet + Private Endpoint for Storage

**Date:** 2026-03-24

Azure policy compliance required that the Storage Account have `publicNetworkAccess: Disabled`. This meant adding network isolation.

### What Was Built

Created `infra/modules/networking.bicep` with:
- **VNet** — `10.0.0.0/16` address space
- **func-integration subnet** — `10.0.1.0/24` for Function App VNet integration
- **private-endpoints subnet** — `10.0.2.0/24` for the blob storage private endpoint
- **Private endpoint** for blob storage
- **Private DNS zone** — `privatelink.blob.core.windows.net` linked to the VNet

### Function App Changes

- Added `vnetSubnetId` parameter to the Function App Flex Consumption plan, pointing to the func-integration subnet
- Set `WEBSITE_CONTENTOVERVNET=1` in app settings to enable deployment content upload through the VNet
- Storage account set to `publicNetworkAccess: 'Disabled'`

### Deployment Validation

`func azure functionapp publish` works through the VNet — Kudu uploads to blob via the private endpoint. No need to temporarily toggle public access on/off during deployments.

---

## Chapter 7: Clips Query Fix + Always-Ready Instances

**Date:** 2026-03-24

### Clips Query Fix

The `clips-query.ts` "latest" mode was originally querying Cosmos DB with an `ORDER BY publishedAt DESC` clause. This required a composite index in Cosmos DB that didn't exist and would have needed manual configuration.

**Fix:** Rewrote the latest mode to use AI Search instead — a wildcard query (`*`) with `orderBy: "publishedAt desc"`. AI Search already has the `publishedAt` field as sortable, so this works out of the box. One fewer Cosmos DB dependency.

### Always-Ready Instances

Copilot Studio has a ~30-second timeout for tool calls. Flex Consumption cold starts were hitting this limit. Added `always-ready=1` for HTTP triggers, which keeps one warm instance available at all times.

**Cost:** ~$34/month — worth it to prevent timeout failures in the agent experience.

---

## Chapter 8: Clips Ingestion Rewrite — Bing News → Direct Scraping

**Date:** 2026-03-24

### Why the Change

The original clips-ingest function used Bing News Search API to find articles mentioning Governor Stein. This worked but had downsides:
- Required a Bing News Search API key stored in Key Vault (~$7/month)
- Added `@azure/keyvault-secrets` and `@azure/identity` as direct dependencies in the function
- Bing results were sometimes noisy (irrelevant articles) or incomplete (missing NC-specific press releases)
- External API dependency added a failure mode

### What Changed

Rewrote `clips-ingest.ts` to scrape `governor.nc.gov/news/press-releases` directly:
- Fetches the first 2 pages of press releases (~20 articles per run)
- Parses listing pages with `JSDOM` to extract title, URL, date, and summary
- Follows each link and extracts full article text using Mozilla **Readability**
- Generates embeddings via Azure OpenAI `text-embedding-3-large`
- Stores in **Cosmos DB** and indexes directly into **Azure AI Search** (previously only Cosmos)
- Deduplicates on URL (SHA-256 hash of URL as document ID)

### What Was Removed

- Bing News Search API integration (entire `fetchBingNews` function, `getBingApiKey`, `BingNewsArticle`/`BingNewsResponse` interfaces)
- `@azure/keyvault-secrets` dependency in this function (Key Vault is still used by APIM)
- `KEY_VAULT_URL` and `BING_SECRET_NAME` environment variables
- Bing News Search resource can be deprovisioned (~$7/month savings)

### Also in This Commit

- `host.json`: Added `functionTimeout: "00:10:00"` — the scraping function needs more than the default 5-minute timeout since it fetches and parses ~20 full articles sequentially
- Added `architecture-cheat-sheet.html` — one-pager explaining why each Azure service was chosen, with cost comparisons and "vs." alternatives
- Added `how-it-works-guide.html` — ELI5 guide with flow diagrams, analogies, chat bubble examples, and talk-track FAQ for narrating the architecture to non-technical audiences

---

## Chapter 9: Cosmos DB Private Endpoint + Open Bug

**Date:** 2026-03-24

### Cosmos DB Private Endpoint

Azure policy compliance required Cosmos DB to also have `publicNetworkAccess: Disabled`, matching the existing Storage lockdown. A private endpoint was added via Azure CLI:

- **Private endpoint** in the `private-endpoints` subnet (10.0.2.0/24)
- **Private DNS zone:** `privatelink.documents.azure.com` linked to the VNet
- Cosmos DB `publicNetworkAccess` set to `Disabled`

This was done via CLI rather than Bicep as a quick fix. It needs to be codified in `infra/modules/networking.bicep` alongside the existing blob storage private endpoint.

### The Open Bug

After the Cosmos DB private endpoint was added, `clips-ingest.ts` started silently failing to write new clips to Cosmos DB. The timer function runs, scrapes governor.nc.gov, finds new articles, but the Cosmos write never completes. No error is surfaced in the function logs.

**Probable causes (need App Insights to confirm):**
1. **Cosmos RBAC permissions** — The Function App's managed identity may not have the correct `sqlRoleAssignment` for the new private endpoint connection path
2. **VNet outbound routing** — The Function App's VNet integration subnet may not have the correct route to the Cosmos private endpoint
3. **DNS resolution** — The private DNS zone may not be resolving correctly from the Function App's VNet integration subnet

The 10 seeded clips continue to work fine for queries. This bug only affects new clip ingestion.

---

## Chapter 10: SPA Demo

**Date:** 2026-03-24

### Why a SPA

Copilot Studio is the production agent experience, but for demos and testing it's useful to have a standalone browser-based interface that doesn't require Teams or a Power Platform license.

### What Was Built

Two files:
- **`demo.html`** — Single-page app with a chat-style UI for all three capabilities (clips, remarks, proofreading)
- **`demo-server.js`** — Express server (port 9090) that proxies requests to APIM, injecting the subscription key from the `APIM_SUBSCRIPTION_KEY` environment variable. This keeps the APIM key out of the browser.

### How to Run

```bash
export APIM_SUBSCRIPTION_KEY=your-key-here
node demo-server.js
# Open http://localhost:9090
```

The SPA hits the same APIM endpoints as Copilot Studio, so it's a faithful representation of the backend capabilities.

---

## Chapter 11: Clips Dedup Bug Fix + Schedule Change + Manual Refresh

**Date:** 2026-03-24

### The Bug

The clips ingestion function was finding new articles on governor.nc.gov but never writing them to Cosmos DB. The TODO originally said "needs Application Insights to diagnose (likely Cosmos write permission or VNet outbound routing)." Turns out it was a code bug, not an infrastructure issue.

The dedup logic in `clips-ingest.ts` reads from Cosmos to check if a clip already exists. For new clips, the read throws a "not found" error which should be caught and ignored. But the catch block checked:

```typescript
const statusCode = (error as { code?: number }).code;
if (statusCode !== 404) throw error;
```

In `@azure/cosmos` v4, `ErrorResponse.code` is the **string** `"NotFound"` from the response body, not the **number** `404`. So `"NotFound" !== 404` was always `true`, and the error was re-thrown. Every new clip failed at dedup.

The seeded clips worked fine because they already existed — the `.read()` succeeded and returned early, never hitting the broken catch block.

**The clue:** The TODO said "finds new articles but silently fails to write." If networking was the problem, it couldn't read existing clips either. The fact that reads worked meant the issue was in the code path between "check if exists" and "write."

### The Fix

One line: check for both the string and number forms:

```typescript
const code = (error as { code?: number | string }).code;
if (code !== 404 && code !== "NotFound") throw error;
```

### Schedule Change

Moved from every 15 minutes (`0 */15 * * * *`) to daily at 7 AM Eastern (`0 0 7 * * *`). The Governor's press office publishes a few times a week — checking every 15 minutes was wasteful. Added `WEBSITE_TIME_ZONE=America/New_York` as a Function App setting so the cron is DST-aware.

### Manual Refresh

Extracted the core ingestion logic into a shared `runIngestion()` function called by both:
- The timer trigger (daily at 7 AM)
- A new HTTP trigger at `POST /api/clips/refresh` for on-demand refresh

Added a green "Refresh Clips" button to `demo.html` that calls the refresh endpoint. Returns `{ successCount, errorCount, totalCount }`.

### Deploy Process Discovery

Discovered that `func azure functionapp publish` cannot upload through the VNet from a local machine — Storage's `publicNetworkAccess: Disabled` blocks it. The deploy process requires:
1. `az storage account update --public-network-access Enabled`
2. `func azure functionapp publish nc-comms-agent-dev-func`
3. `az storage account update --public-network-access Disabled`

Also created `.funcignore` to exclude `.git`, `infra/`, `seed/`, `src/`, `*.ts`, `*.md` from the deploy package — without it the archive was too large and uploads would hang.

---

## Chapter 12: Demo Questions + Presentation PPTX

**Date:** 2026-03-26

### Demo Questions

Created `docs/html/demo-questions.html` — a styled one-pager with sample prompts organized by capability:

- **News Clips** (5 questions) — broadband, latest news, Hurricane Helene recovery, law enforcement pay, jobs/economic development. Each verified against seeded clips.
- **Remarks Search** (5 questions) — mental health/public safety, kids online, hurricane recovery, food banks/hunger, NC history/democracy. Each mapped to specific seeded columns.
- **Proofread** (2 sample transcripts) — a short one for quick demos and a longer one with speaker labels, both loaded with realistic ASR-style errors

Also generated `docs/demo-questions.pptx` — same content in PowerPoint format with a suggested demo flow slide.

### Presentation PPTX

Generated `docs/html/presentation.pptx` from the existing HTML slide deck using `python-pptx`. 8 slides total: Title → The Ask → News Clips → Remarks Search → Proofread + Platform → Architecture Overview → Request Flow → Data Flow.

### 3-Request Split

The original presentation framed the customer's ask as 2 requests (clips + proofreading combined, remarks separate). Proofreading is its own distinct capability, so the Ask slide was split into 3 separate request cards, each with its own quote.

### Build Scripts

- `docs/build-demo-pptx.py` — generates `docs/demo-questions.pptx`
- `docs/build-presentation-pptx.py` — generates `docs/html/presentation.pptx`

Both use `python-pptx` and can be re-run to regenerate after edits.

---

## Chapter 13: Architecture Diagrams + Cold Start Fix

**Date:** 2026-03-26

### Cold Start Timeout

During demo testing, the first Copilot Studio query hit a 240-second `ConnectorTimeoutError` — the Function App wasn't warm. The `always-ready=1` setting was documented in ARCHITECTURE.md but was never actually added to the Bicep.

**Fix:** Added `alwaysReady: [{ name: 'http', instanceCount: 1 }]` to the `scaleAndConcurrency` block in `infra/modules/function-app.bicep`. This keeps 1 instance warm for HTTP triggers at all times (~$34/month).

### Demo Questions Verified

Several demo questions didn't produce results:
- "Has the Governor said anything about rural internet access?" — no clips contained "rural internet" (broadband clip existed but semantic match wasn't strong enough)
- "Are there any clips about education or schools?" — weak match

Trimmed from 6+7 to 5+5 and verified every question hits specific seeded content by keyword AND semantic match.

### Three Diagram Slides

Added 3 new slides to `presentation.pptx` (slides 6–8):

1. **Architecture Overview** (navy background) — Left-to-right service topology: Teams/Web → Copilot Studio → APIM → Azure Functions → backend services (OpenAI, AI Search, Cosmos DB stacked vertically). Supporting services row below (Key Vault, Blob Storage, VNet, Managed Identity). Cost callout at bottom.

2. **Request Flow** (white background, swim lanes) — Three horizontal lanes showing the runtime path for each capability. Each lane has a colored accent bar, capability label, and 4 numbered step boxes with arrows. Shows what happens from user question to result.

3. **Data Flow** (white background) — Split into DATA IN (ingestion) and DATA OUT (queries). Ingestion shows timer/blob triggers → process → embed → store. Queries show user question → route → search/synthesize → display. Color-coded to match capabilities.

---

## Chapter 14: Web News Search via Azure OpenAI Responses API

**Date:** 2026-03-26

### The Problem

Clips ingestion only covered governor.nc.gov press releases — official government output. The comms team also needs to monitor external media coverage (WRAL, News & Observer, Charlotte Observer, AP, etc.). The original plan was to use Bing News Search API, but Bing Search v7 APIs are retired — you can't create new resources.

### The Solution

Azure OpenAI's **Responses API** includes a `web_search` tool powered by Bing grounding. This is the replacement for the standalone Bing Search APIs. No new Azure resource needed — it uses the existing Azure OpenAI resource with the same managed identity auth.

### What Was Built

1. **`webSearch()` helper in `openai-client.ts`** — Uses the `OpenAI` class (not `AzureOpenAI`) with a special base URL: `${endpoint}/openai/v1/`. The Responses API requires this path. Auth is via `getBearerTokenProvider` — the token is passed as `apiKey` to the `OpenAI` constructor. URL citations are extracted from response annotations (`type === "url_citation"`).

2. **`fetchWebNewsListings()` in `clips-ingest.ts`** — Calls `webSearch()` with prompts targeting NC news outlets. Filters out `governor.nc.gov` URLs (the gov scraper already covers those). Returns `ClipListing[]` with outlet names extracted via `outletFromUrl()`. (Later enhanced to run 5 parallel queries — see Chapter 15.)

3. **`outletFromUrl()` domain mapper** — Static `Record<string, string>` mapping hostnames to friendly names: `wral.com` -> "WRAL", `newsobserver.com` -> "News & Observer", `charlotteobserver.com` -> "Charlotte Observer", etc. Falls back to the raw hostname for unmapped domains.

4. **Parallel execution** — `runIngestion()` now runs `fetchGovListings()` and `fetchWebNewsListings()` in parallel via `Promise.all`. Results are merged and deduplicated by URL hash (first occurrence wins).

5. **Enhanced refresh response** — The `POST /api/clips/refresh` endpoint now returns `newCount`, `skippedCount`, and a `sources: { gov, web }` breakdown so callers can see how many clips came from each source.

### Cosmos SDK v4 Dedup Fix

The previous dedup logic used try/catch around `container.item(id, id).read()`, expecting a thrown exception for missing items. In `@azure/cosmos` v4, `.read()` returns `{ statusCode: 404, resource: undefined }` instead of throwing. The fix changed the dedup check to:

```typescript
const { resource: existingClip, statusCode } = await container.item(id, id).read<NewsClip>();
if (statusCode === 200 && existingClip) {
  // Already exists, skip
  return "skipped";
}
```

### `.funcignore` Optimization

Added `docs` and `connector` to `.funcignore`. These directories contained PowerPoint files, HTML guides, and the OpenAPI spec — none needed at runtime. Deploy archive dropped from ~1.4GB to ~145MB (with `npm ci --omit=dev`).

### Results

- Clips index grew from 23 to 30 clips (7 new external media: WRAL, US News, Carolina Journal, North State Journal, NC Newsline)
- Cost: ~$0.035 per web search call, ~$1/month at once-daily (single query)
- No new Azure resources provisioned
- Same managed identity auth — no API keys

---

## Chapter 15: Multi-Query Web Search + Timeframe Split

**Date:** 2026-03-26

### The Problem

A single web search query was only returning 7-12 external articles. The comms team needs broader coverage across topic areas — budget, education, Hurricane Helene recovery, healthcare, law enforcement, economy. A single generic query like "Governor Stein news" couldn't cover all these beats effectively.

### The Solution

Replaced the static `WEB_SEARCH_QUERIES` array with a `webSearchQueries(timeframe)` function that generates 5 focused queries, each targeting a specific topic area:

1. **General coverage** — WRAL, News & Observer, Charlotte Observer, AP
2. **Budget/education** — budget, education, teachers
3. **Helene recovery** — Hurricane Helene, western NC recovery
4. **Medicaid/healthcare** — Medicaid, healthcare policy
5. **Law enforcement/economy** — law enforcement, public safety, economy, jobs

Each query includes a timeframe parameter and a `NO_GOV` instruction to exclude governor.nc.gov links (the gov scraper already handles those).

### Key Changes

1. **`webSearchQueries(timeframe)`** — Function instead of static array. Takes "past week" or "past 6 months" parameter that's embedded in each query string.

2. **`search_context_size: "high"`** — Set on the `web_search` tool configuration to get more citations per query (previously used default).

3. **Timeframe split** — Daily 7 AM timer passes "past week" (focused on catching new coverage). Manual `POST /api/clips/refresh` passes "past 6 months" (useful for backfilling historical coverage).

4. **Parallel execution** — All 5 queries run via `Promise.all` with individual `.catch(() => [])` so one failed query doesn't block the others.

5. **Cross-query dedup** — Results from all 5 queries are merged with a `Set<string>` tracking seen URLs before the merge with gov results.

### Results

- **58 clips total** across 21 outlets: NC Governor (23), WRAL (8), WUNC (4), CBS17 (3), Carolina Journal (2), WLOS (2), NC Newsline (2), plus US News, The Assembly, News From The States, EdNC, and more
- Each query returns ~8-12 URLs; combined: ~30-40 unique external URLs per run (after dedup and governor.nc.gov filtering)
- **Cost:** ~$0.175/day (5 queries x $0.035/call) = ~$5/month for the daily run
- No new Azure resources — same managed identity auth, same OpenAI resource

---

## Chapter 16: Audio/Video Transcription via Whisper

**Date:** 2026-03-26

### The Request

The customer asked about adding video transcription — uploading recordings and getting text transcripts back. Three Azure services were evaluated:

1. **Azure OpenAI Whisper** — simplest, uses the existing Azure OpenAI resource and managed identity auth. 25 MB file limit.
2. **Azure AI Speech (batch transcription)** — purpose-built, supports speaker diarization, no file size limit. More complex setup.
3. **Azure AI Video Indexer** — full video analysis (faces, topics, sentiment). Overkill for transcription only.

Decision: **Whisper** — zero new Azure resources, same auth pattern, minimal code.

### What Was Built

**Infrastructure (deployed via CLI, also added to Bicep):**
- `whisper` model deployment on existing Azure OpenAI resource (v001, Standard SKU, 3 concurrent requests)
- `WHISPER_DEPLOYMENT_NAME=whisper` env var on Function App
- `POST /transcribe` operation on APIM

**Code:**
- `transcribeAudio(buffer, filename, language?)` helper in `openai-client.ts` — uses `toFile()` from the `openai` package to convert a Buffer to a File object for the Whisper API
- `TranscribeResponse` interface in `types.ts` — `{ transcript, filename, fileSizeBytes }`
- `transcribe.ts` function — HTTP POST handler that accepts multipart/form-data file uploads, validates file extension and size, and calls Whisper

**Deployment note:** The full Bicep deployment failed due to pre-existing conflicts in the networking module (private DNS zone already linked to VNet) and Cosmos DB module (partition key can't be changed). The three new resources were deployed individually via Azure CLI:
1. `az cognitiveservices account deployment create` — Whisper model
2. `az functionapp config appsettings set` — env var
3. `az apim api operation create` — APIM operation
4. `func azure functionapp publish` — function code (after `npm ci --omit=dev` and toggling storage public access)

### Documentation

Created `docs/html/video-processing-functionality.html` — a styled one-page explainer covering:
- What was built and how it works (flow diagram + architecture diagram)
- Supported file formats and limitations
- API usage with curl examples
- Copilot Studio integration options (direct HTTP action vs Power Automate flow)
- Transcribe + Proofread chaining pattern
- Cost impact (~$0.006/min of audio, ~$3/month at 50 transcriptions)

---

## Chapter 17: React Dashboard + Run Logging

**Date:** 2026-03-26

### The Problem

There was no way to see the state of the platform without querying Cosmos DB directly. How many clips are indexed? Which outlets are represented? When did the last ingestion run? Did it succeed? Staff and admins need this at a glance.

### Dashboard Backend — 4 GET Endpoints

Created `src/functions/dashboard.ts` with four endpoints:

1. **`GET /api/dashboard/stats`** — Aggregates clip count, remarks count, outlet breakdown (GROUP BY), and latest ingestion run in a single `Promise.all` call. Returns a `DashboardStats` object.

2. **`GET /api/dashboard/clips`** — Paginated clip listing (offset/limit, max 50 per page). Supports `outlet`, `dateFrom`, `dateTo` query parameters. Parameterized Cosmos SQL queries to prevent injection.

3. **`GET /api/dashboard/remarks`** — All remarks metadata documents, sorted by date descending.

4. **`GET /api/dashboard/runs`** — Recent ingestion runs from the `ingestion-state` container, sorted by completion time descending.

All four endpoints registered in APIM (`apim.bicep`) with GET methods.

### Run Logging

Each clips ingestion (both the daily timer and manual refresh) now persists an `IngestionRun` document to the `ingestion-state` Cosmos container. Fields: `id`, `trigger` (timer/manual), `startedAt`, `completedAt`, `durationMs`, `newCount`, `skippedCount`, `errorCount`, `totalCount`, `sources: { gov, web }`, `status` (success/partial/failed).

New types added to `types.ts`: `IngestionRun` and `DashboardStats`.

### Dashboard Frontend — React SPA

Created `/dashboard` as a standalone React project:

- **Tech stack:** React 19, Vite 8, Tailwind CSS v4, TypeScript strict mode
- **No extras:** No routing library, no state management library, no charting library. Just React state and `fetch()`.
- **Types shared:** `vite.config.ts` defines a `@shared` path alias pointing to `../src/shared`, so the dashboard imports `IngestionRun`, `DashboardStats`, etc. directly from the backend types file.
- **Dev proxy:** Vite dev server proxies `/api` requests to APIM (or directly to the Function App if `VITE_APIM_BASE_URL` points to `*.azurewebsites.net`), injecting the correct auth header automatically.

Four tabs:
- **Overview** (`StatsPanel`) — Stat cards for total clips/remarks, horizontal bars for outlet breakdown, latest run status card with auto-refresh
- **Clips** (`ClipsFeed`) — Paginated clip list with outlet dropdown and date range filters
- **Remarks** (`RemarksList`) — Document table with title, date, event, chunk count
- **Runs** (`RunsHistory`) — Ingestion run history with status badges (success/partial/failed), source breakdown, timing

### Local Dev

```bash
cd dashboard
npm install
cp .env.example .env.local
# Set VITE_APIM_SUBSCRIPTION_KEY in .env.local
npm run dev
# Open http://localhost:5173
```

### `.funcignore` Updated

Added `dashboard` to `.funcignore` so the React SPA (including its `node_modules`) doesn't get included in the Azure Functions deploy package.

---

## Chapter 18: 78 Clips Across 29 Outlets

**Date:** 2026-03-26

The clips index grew from 58 clips across 21 outlets to 78 clips across 29 outlets after additional ingestion runs with the multi-query web search. The 5-query approach covers more topic areas and catches articles from smaller regional outlets that a single generic query would miss.

---

## Chapter 19: GPT-5-chat Upgrade + Model Quality Comparison

**Date:** 2026-03-30

### The Upgrade

The backend was upgraded from GPT-4o to GPT-5-chat (`gpt-5-chat`, 2025-10-03, GlobalStandard). A second deployment (`gpt-5`, 2025-08-07, GlobalStandard) was also added. Both deployments were created manually via `az cognitiveservices account deployment create` — they still need to be codified in `infra/modules/openai.bicep`.

The switch is controlled by the `GPT4O_DEPLOYMENT_NAME` environment variable (name is legacy — the actual model is now gpt-5-chat).

### Reasoning Model Support

`openai-client.ts` was updated to auto-detect reasoning models (`gpt-5*`, `o*` prefixes) and adjust API parameters:
- Uses `max_completion_tokens` instead of `max_tokens` (reasoning models require this)
- Drops `temperature` (reasoning models don't support it)
- Default token budget bumped to 16,384 (reasoning models use tokens for internal chain-of-thought)
- Remarks synthesis bumped from 1,500 to 8,192 max tokens to accommodate reasoning overhead

### Model Quality Comparison

Ran 7 test questions across 4 configurations:
1. **Raw API — GPT-4o** (previous production)
2. **Raw API — GPT-5-chat** (new production)
3. **Copilot Studio Generative** (GPT-4.0 orchestrator + GPT-5-chat backend)
4. **Copilot Studio Classic** (GPT-4.0 orchestrator + GPT-5-chat backend, manual topics)

Key findings:
- GPT-5-chat produces richer synthesis (markdown tables, deeper quote analysis, evolution tracking)
- For clips queries, retrieval doesn't depend on the chat model — results are identical
- Generative orchestration preserves content quality well through the GPT-4.0 "last mile"
- Classic orchestration has higher fidelity when routed correctly, but trigger phrase sensitivity is a problem
- Recommendation: GPT-5-chat backend + Generative orchestration as default

Results saved in `seed/test-*.json` and `inbox/`. Final comparison doc at `docs/model-quality-comparison.html`.

### Connector Updated

The custom connector was updated to 4 operations (TranscribeFile added via `pac connector update`). All 4 tools now active in Copilot Studio generative orchestration.

---

## Chapter 20: 118 Clips Across 40+ Outlets

**Date:** 2026-03-30

The clips index grew from 78 clips across 29 outlets to **118 clips across 40+ outlets** after running the daily timer and manual refresh with the GPT-5-chat backend. The 5-query web search continues to find articles from a wide range of NC media outlets.

A full snapshot of all 118 clips (title, date, outlet) was saved to `seed/clips-snapshot-2026-03-30.txt`. A new `seed/dump-clips.ts` script was created to dump all clips from Cosmos DB (`npx tsx seed/dump-clips.ts`).

---

*More chapters will be added as implementation progresses.*
