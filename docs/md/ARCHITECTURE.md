# Architecture — NC DIT AI Office Agent

## Overview

A serverless AI platform for the North Carolina Governor's Communications Office that automates **news clip monitoring**, provides **semantic search over historical remarks**, and offers **AI-powered transcript proofreading**. The agent experience is delivered through **Microsoft Copilot Studio**, giving staff a conversational interface in Teams (or web) without custom frontend development.

---

## System Context

```
┌─────────────────────────────────────────────────────────────┐
│                     Copilot Studio Agent                    │
│              (Teams / Web / SharePoint embed)               │
└──────────────────────────┬──────────────────────────────────┘
                           │  Custom Connector (GCC: og-ai)
                           │  Ocp-Apim-Subscription-Key
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                Azure API Management (APIM)                  │
│  https://nc-comms-agent-dev-apim.azure-api.net/comms        │
│           Auth boundary · Rate limiting · Logging           │
└────┬──────────────┬──────────────┬──────────────────────────┘
     │              │              │
     ▼              ▼              ▼
┌─────────┐  ┌───────────┐  ┌──────────────┐
│ Clips   │  │ Remarks   │  │ Transcript   │
│ Function│  │ Function  │  │ Proofread    │
│         │  │           │  │ Function     │
└────┬────┘  └─────┬─────┘  └──────┬───────┘
     │             │               │
     ▼             ▼               ▼
┌─────────┐  ┌───────────┐  ┌──────────────┐
│ Cosmos  │  │ Azure AI  │  │ Azure OpenAI │
│ DB      │  │ Search    │  │ (GPT-4o)     │
└─────────┘  └───────────┘  └──────────────┘
```

---

## Use Cases

### 1. News Clips — Governor Stein Mention Monitoring

**Goal:** Automatically identify news articles mentioning Governor Stein — from both the Governor's press office and external media — and surface structured summaries to comms staff.

#### Data Flow

1. **Timer-triggered Azure Function** runs daily at 7 AM Eastern using "past week" timeframe (also available as on-demand HTTP trigger at `POST /api/clips/refresh` using "past 6 months" for backfill)
2. **Two sources run in parallel** via `Promise.all`:
   - **Gov scraper** — scrapes **governor.nc.gov/news/press-releases** (first 2 pages, ~20 articles) using `fetch` + `JSDOM`
   - **Multi-query web search** — runs **5 focused queries** in parallel via **Azure OpenAI Responses API with Bing grounding** (`web_search` tool, `search_context_size: "high"`). Each query targets a different topic area: general coverage, budget/education, Helene recovery, Medicaid/healthcare, law enforcement/economy. The `webSearchQueries()` function generates queries with a timeframe parameter. Each query returns ~8-12 URLs; combined: ~30-40 unique external URLs per run. Uses the `OpenAI` class (not `AzureOpenAI`) with the `/openai/v1/` base URL. No separate Bing Search resource needed — uses the existing Azure OpenAI resource with managed identity auth.
3. Results are merged and deduplicated by URL hash (first occurrence wins)
4. For each new article, follows the link and extracts full text via **Mozilla Readability**:
   - **Title**
   - **First paragraph** (lede)
   - **First mention context** (sentence/paragraph containing the Governor's name)
   - **Full article text**
   - **Outlet name** (extracted from URL hostname via `outletFromUrl()` domain mapping)
5. Generates a vector embedding via **Azure OpenAI text-embedding-3-large**
6. Deduplicates on URL (SHA-256 hash) — Cosmos `.read()` returns `statusCode 404` for missing items (not a thrown exception); dedup checks `statusCode === 200 && existingClip`
7. Stores structured clip in **Cosmos DB** and indexes into **Azure AI Search** for hybrid retrieval
8. Optionally sends a **daily digest** via Logic App + Outlook connector

> **Cost:** Web search via the Responses API costs ~$0.035 per call ($35/1K). With 5 queries per run: ~$0.175/day, ~$5/month for the daily run.
> **Note:** Bing Search v7 APIs are retired (no new resources can be created). The replacement is Grounding with Bing Search via Azure OpenAI Responses API.

#### Copilot Studio Interactions

| User intent | Example utterance | Backend action |
|---|---|---|
| Browse today's clips | "Show me today's clips" | Query Cosmos DB, return formatted card list |
| Search clips by topic | "Any clips about clean energy this week?" | Hybrid search against AI Search clips index |
| Get clip detail | "Show me the full context for that WRAL article" | Fetch full record from Cosmos DB |

### 2. Remarks — Semantic Search & Retrieval

**Goal:** Let comms staff search the full corpus of Governor's remarks by topic and retrieve the exact language previously used.

#### Data Flow — Ingestion

1. Staff uploads remarks (Word/PDF/plain text) to a **SharePoint document library** or blob container
2. **Event-triggered Azure Function** fires on new/updated document
3. Function chunks the document by logical section (heading-aware splitting)
4. Each chunk is embedded via **Azure OpenAI `text-embedding-3-large`**
5. Chunks + metadata (date, event name, venue, topic tags) are indexed into **Azure AI Search** (vector + keyword hybrid index)

#### Data Flow — Query

1. User asks a question in Copilot Studio
2. Copilot Studio calls the **Remarks Function** via APIM
3. Function executes **hybrid search** (vector similarity + BM25 keyword) against the remarks index
4. Top-K chunks are passed to **Azure OpenAI GPT-4o** with a synthesis prompt:
   - Summarize the language used on the requested topic
   - Include direct quotes with citations (date, event)
   - Flag any contradictions or evolution in messaging over time
5. Structured response returned to Copilot Studio for display

#### Copilot Studio Interactions

| User intent | Example utterance | Backend action |
|---|---|---|
| Topic search | "What language have we used on clean tech?" | Hybrid search → GPT-4o synthesis |
| Quote retrieval | "Find the exact quote about broadband from the State of the State" | Filtered vector search (event = State of the State) |
| Compare messaging | "How has our education messaging changed since 2024?" | Time-filtered search → GPT-4o comparison |

### 3. Transcript Proofreading

**Goal:** Clean up faulty transcripts (ASR/OCR artifacts) using AI.

#### Data Flow

1. Staff pastes or uploads a raw transcript in Copilot Studio
2. Copilot Studio sends transcript to **Transcript Proofread Function** via APIM
3. Function calls **Azure OpenAI GPT-4o** with a proofreading system prompt:
   - Fix obvious ASR/OCR errors (homophones, garbled words, missing punctuation)
   - Normalize speaker labels
   - Preserve original meaning — flag uncertain corrections with `[?]`
4. Returns corrected transcript with a change summary

---

## Copilot Studio — Agent Design

### Why Copilot Studio

- **No custom frontend** — ships with Teams, web, and SharePoint embed channels out of the box
- **Managed auth** — Entra ID SSO, no token plumbing in application code
- **Topic routing** — built-in intent recognition routes to the right backend action
- **Adaptive Cards** — rich formatted responses (clip cards, quote blocks, tables) without custom UI
- **Generative Answers** — fallback to grounded AI answers when no topic matches exactly

### Agent Topology

The agent uses **generative orchestration** — no manual topics are needed. The orchestrator reads the OpenAPI operation descriptions from the custom connector and selects the right tool based on user intent.

```
┌──────────────────────────────────────────────┐
│              Copilot Studio Agent             │
│         (Generative Orchestration)           │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  Orchestrator selects tool based on  │    │
│  │  OpenAPI operation descriptions:     │    │
│  │                                      │    │
│  │  • QueryClips                        │    │
│  │  • QueryRemarks                      │    │
│  │  • ProofreadTranscript               │    │
│  └────────────────┬─────────────────────┘    │
│                   │                          │
│                   ▼                          │
│  ┌──────────────────────────────────────┐    │
│  │  Power Platform Custom Connector     │    │
│  │  OpenAPI 2.0 → APIM → Functions      │    │
│  │  (deployed to GCC env: og-ai)        │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

### Tool Selection

The orchestrator maps user intent to the correct tool automatically:

| User intent | Example utterance | Tool selected |
|---|---|---|
| Browse today's clips | "Show me today's clips" | QueryClips (mode: latest) |
| Search clips by topic | "Any clips about clean energy this week?" | QueryClips (mode: search) |
| Search remarks by topic | "What language have we used on clean tech?" | QueryRemarks |
| Find a specific quote | "Find the quote about broadband from the State of the State" | QueryRemarks (with filters) |
| Proofread a transcript | "Proofread this transcript" | ProofreadTranscript |

---

## Azure Resource Map

| Resource | SKU / Tier | Purpose |
|---|---|---|
| **Azure Functions** (Function App) | Flex Consumption (FC1, Linux), always-ready=1 for HTTP | 7 functions — clips ingestion/query/refresh/digest, remarks ingestion/query, proofread |
| **Azure API Management** | Consumption | Auth boundary, rate limiting (60/min), function key injection |
| **Azure AI Search** | Basic (B) | Hybrid vector + keyword indexes for clips and remarks |
| **Azure OpenAI** | Standard (East US 2) | GPT-4o (30K TPM) for synthesis/proofread + Responses API with Bing grounding for multi-query web news search (5 queries/run, ~$5/mo), text-embedding-3-large (120K TPM) for vectors |
| **Azure Cosmos DB** | Serverless (NoSQL) | `clips`, `ingestion-state`, `remarks-metadata`, `remarks-chunks` containers |
| **Azure Key Vault** | Standard (RBAC mode) | Function host key for APIM (no external API keys — multi-query web search uses Azure OpenAI's built-in Bing grounding with managed identity) |
| **Azure Blob Storage** | Standard LRS (public access disabled) | `remarks-uploads` container for document staging |
| **VNet** | 10.0.0.0/16 | Network isolation for storage and Cosmos DB; Function App VNet integration |
| **Private Endpoint** | Blob Storage | Private connectivity to storage via `privatelink.blob.core.windows.net` |
| **Private Endpoint** | Cosmos DB | Private connectivity to Cosmos DB via `privatelink.documents.azure.com` (CLI-provisioned, not yet in Bicep) |
| **Copilot Studio** | Per-tenant license | Agent experience — Teams, web, SharePoint (fully working, generative orchestration) |
| **Power Platform Custom Connector** | GCC environment (`og-ai`) | OpenAPI 2.0 bridge between Copilot Studio and APIM (3 actions) |
| **Logic App** (optional, future) | Consumption | Daily digest email delivery |

---

## Identity & Auth

All service-to-service authentication uses **managed identity** and **DefaultAzureCredential**. No connection strings or API keys in application code. Key Vault uses **RBAC authorization mode** (not access policies). Clips ingestion scrapes governor.nc.gov and searches the web via Azure OpenAI's Responses API with Bing grounding — no external API keys required (web search uses the same managed identity auth as chat completions). Both Blob Storage and Cosmos DB have `publicNetworkAccess: Disabled` and are accessed exclusively through private endpoints.

| Caller | Target | Auth mechanism | Role |
|---|---|---|---|
| Copilot Studio | Custom Connector | APIM subscription key (securestring) | — |
| Custom Connector | APIM | `Ocp-Apim-Subscription-Key` header | — |
| APIM | Azure Functions | Function host key injected at gateway policy | — |
| APIM | Key Vault | Managed identity | `Key Vault Secrets User` |
| Azure Functions | Azure OpenAI | Managed identity | `Cognitive Services OpenAI User` |
| Azure Functions | Azure AI Search | Managed identity | `Search Index Data Reader` + `Search Index Data Contributor` |
| Azure Functions | Cosmos DB | Managed identity (native RBAC) | `Cosmos DB Built-in Data Contributor` (via `sqlRoleAssignments`) |
| Azure Functions | Blob Storage | Managed identity (via VNet private endpoint) | `Storage Blob Data Reader` |
| Azure Functions | Key Vault | Managed identity | `Key Vault Secrets User` |

> **Note:** Cosmos DB data-plane access uses its own native RBAC system (`sqlRoleAssignments`), not ARM `roleAssignments`. This is handled in `infra/modules/role-assignments.bicep`.

---

## Networking

Both Storage and Cosmos DB are locked down with `publicNetworkAccess: Disabled` for policy compliance. All access goes through private endpoints.

```
┌──────────────────────────────────────────────────────┐
│                  VNet  10.0.0.0/16                    │
│                                                      │
│  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │  func-integration    │  │  private-endpoints   │  │
│  │  10.0.1.0/24         │  │  10.0.2.0/24         │  │
│  │                      │  │                      │  │
│  │  Function App        │  │  Private EP          │  │
│  │  (VNet integration)  │──│  → Blob Storage      │  │
│  │                      │  │  → Cosmos DB         │  │
│  └──────────────────────┘  └──────────────────────┘  │
│                                                      │
│  Private DNS Zones:                                  │
│    privatelink.blob.core.windows.net                 │
│    privatelink.documents.azure.com                   │
└──────────────────────────────────────────────────────┘
```

> **Note:** The Cosmos DB private endpoint was added via Azure CLI and is not yet codified in `networking.bicep`.

- **Function App VNet integration** via `vnetSubnetId` parameter on the Flex Consumption plan
- **`WEBSITE_CONTENTOVERVNET=1`** enables deployment content upload over VNet
- **`func azure functionapp publish`** requires temporarily setting Storage `publicNetworkAccess: Enabled`, then back to `Disabled` after deploy. The `func` CLI cannot upload through the VNet from a local machine.
- **Always-ready=1** on HTTP triggers eliminates cold start timeouts (~$34/month additional)

---

## Data Model

### Clips Index (Cosmos DB + AI Search)

```json
{
  "id": "sha256-of-url",
  "url": "https://example.com/article",
  "outlet": "WRAL",
  "title": "Governor Stein announces broadband initiative",
  "publishedAt": "2026-03-22T14:30:00Z",
  "lede": "First paragraph of the article...",
  "mentionContext": "The sentence or paragraph containing the first mention...",
  "mentionOffset": 342,
  "fullText": "Full article text if available...",
  "ingestedAt": "2026-03-22T14:45:00Z",
  "embedding": [0.012, -0.034, ...]
}
```

### Remarks Index (AI Search)

```json
{
  "id": "remarks-2026-01-15-state-of-state-chunk-003",
  "remarkId": "remarks-2026-01-15-state-of-state",
  "title": "2026 State of the State Address",
  "date": "2026-01-15",
  "event": "State of the State",
  "venue": "NC General Assembly",
  "chunkIndex": 3,
  "chunkText": "The actual text of this section...",
  "topicTags": ["education", "broadband", "clean tech"],
  "embedding": [0.008, -0.021, ...]
}
```

---

## Implementation Phases

### Phase 1 — Foundation (Week 1–2)

- Provision Azure resources (IaC with Bicep)
- Stand up APIM with Copilot Studio custom connector
- Deploy Transcript Proofread Function (simplest, proves the pipeline end-to-end)
- Configure Copilot Studio agent with Transcript Proofread topic
- **Deliverable:** Staff can paste a transcript in Teams and get a corrected version back

### Phase 2 — Remarks Search (Week 3–4)

- Build remarks ingestion pipeline (upload → chunk → embed → index)
- Deploy Remarks Query Function (hybrid search → GPT-4o synthesis)
- Add Remarks topics to Copilot Studio
- Load initial corpus of existing remarks
- **Deliverable:** Staff can search historical remarks by topic in Teams

### Phase 3 — News Clips (Week 5–6)

- Deploy Clips Ingestion Function (timer-triggered, scrapes governor.nc.gov)
- Build Cosmos DB storage and AI Search clips index
- Deploy Clips Query Function
- Add Clips topics to Copilot Studio
- Configure daily digest (Logic App + Outlook)
- **Deliverable:** Automated clip monitoring with conversational access

### Phase 4 — Polish & Expand (Week 7–8)

- Tune search relevance (boost weights, synonym maps)
- Add Adaptive Card formatting for rich clip/quote display
- Generative Answers fallback grounded on both indexes
- User acceptance testing with comms staff
- **Deliverable:** Production-ready agent

---

## Cost Estimate (Monthly Steady-State)

| Resource | Estimated monthly cost |
|---|---|
| Azure Functions (Flex Consumption + always-ready=1) | ~$34–45 |
| APIM (Consumption) | ~$3.50 per million calls |
| Azure AI Search (Basic) | ~$70 |
| Azure OpenAI (GPT-4o + embeddings + Bing grounding web search) | ~$35–85 (usage-dependent; multi-query web search adds ~$5/mo at 5 queries/day) |
| Cosmos DB (Serverless) | ~$5–20 |
| Blob Storage + VNet/Private Endpoint | ~$5 |
| Copilot Studio | Per-tenant (likely already licensed) |
| **Total** | **~$125–200/mo** |

---

## Implementation Status

| Component | Status | Notes |
|---|---|---|
| Bicep IaC (all resources) | Deployed | 9 modules in `rg-nc-comms-agent-dev`, all RBAC grants active |
| VNet + Private Endpoints | Deployed | VNet 10.0.0.0/16, func-integration subnet (10.0.1.0/24), private-endpoints subnet (10.0.2.0/24), blob PE + DNS zone (in Bicep), Cosmos DB PE + DNS zone (CLI-only, needs Bicep codification) |
| Transcript Proofread Function | Deployed & tested | POST `/api/proofread` — structured JSON with changes + confidence |
| Clips Ingestion Function | Deployed & enhanced | Timer trigger (7 AM ET daily, "past week" timeframe) + manual HTTP refresh (`POST /api/clips/refresh`, "past 6 months" for backfill). Multi-query web search: `webSearchQueries()` generates 5 focused queries (general, budget/education, Helene recovery, Medicaid/healthcare, law enforcement/economy) run in parallel with `search_context_size: "high"`. Combined: ~30-40 unique external URLs per run. Gov scraper + web search run in parallel via `Promise.all`. Cost: ~$0.175/day ($5/month). |
| Clips Query Function | Deployed & tested | POST `/api/clips/query` — "latest" mode (AI Search wildcard + orderBy) + hybrid search. 58 clips indexed across 21 outlets: NC Governor (23), WRAL (8), WUNC (4), CBS17 (3), Carolina Journal (2), WLOS (2), NC Newsline (2), plus US News, The Assembly, News From The States, EdNC, and more. |
| Clips Digest Function | Deployed (stub) | HTML generation done, email sending TBD (needs Logic App or SendGrid) |
| Remarks Ingestion Function | Deployed (partial) | Blob trigger registered but not firing reliably on Flex Consumption; use `seed/load-remarks.ts` as workaround. `.docx`/`.pdf` extraction still stubbed. |
| Remarks Query Function | Deployed & tested | POST `/api/remarks/query` — hybrid search + GPT-4o RAG synthesis with direct quotes and citations. 2025 State of the State seeded (17 chunks). |
| Shared clients (OpenAI, Search, Cosmos) | Deployed | Singleton pattern, DefaultAzureCredential, all auth working. `openai-client.ts` exports `webSearch()` helper using `OpenAI` class with `/openai/v1/` base URL for Responses API (`search_context_size: "high"` for more citations per query). |
| AI Search indexes | Created | `clips` index (11 fields) and `remarks` index (10 fields), both with HNSW vector search + semantic config |
| Seed tooling | Built | `seed/` directory with data loading scripts for clips, remarks, and search indexes |
| Power Platform custom connector | Deployed | OpenAPI 2.0 spec with 3 actions (QueryClips, QueryRemarks, ProofreadTranscript), deployed to GCC environment (`og-ai`) |
| APIM function key | Configured | Named value `function-host-key` set with actual Function App host key |
| APIM endpoints | Tested | All 3 endpoints verified: `/comms/clips/query`, `/comms/remarks/query`, `/comms/proofread` |
| Copilot Studio agent | Deployed & working | Generative orchestration — all 3 tools (QueryClips, QueryRemarks, ProofreadTranscript) active, no manual topics needed |
| SPA demo | Working | `demo.html` + `demo-server.js` on port 9090, routes through APIM with subscription key from `APIM_SUBSCRIPTION_KEY` env var |
| Always-ready instances | Configured (in Bicep) | `alwaysReady: [{ name: 'http', instanceCount: 1 }]` in `function-app.bicep` scaleAndConcurrency. Eliminates cold start timeouts (~$34/month). |

## Open Questions

1. ~~**News source scope**~~ — Resolved: dual-source approach. Governor.nc.gov scraper for official press releases + Azure OpenAI Responses API with Bing grounding for external media (WRAL, News & Observer, Charlotte Observer, AP, etc.). Bing Search v7 APIs are retired; the Responses API `web_search` tool is the replacement. No new Azure resource needed.
2. **Remarks corpus format** — Are existing remarks in Word docs, PDFs, or a CMS? This affects the ingestion pipeline.
3. **Access control** — Should all comms staff see all clips/remarks, or are there sensitivity tiers?
4. **Retention** — How long to keep clips? Archive after 90 days?
5. ~~**Existing Copilot Studio environment**~~ — Resolved: using GCC Power Platform environment (`og-ai`). Custom connector deployed.
6. ~~**Copilot Studio agent configuration**~~ — Resolved: generative orchestration selects tools automatically from OpenAPI descriptions. No manual topics needed.
