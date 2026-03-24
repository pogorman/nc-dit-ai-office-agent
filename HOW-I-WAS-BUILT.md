# How I Was Built — NC DIT AI Office Agent

An ELI5 walkthrough of how this project was designed and built, documenting the prompts, decisions, and results along the way.

---

## Chapter 1: The Ask

**Date:** 2026-03-23

The NC DIT AI Office came to us with two needs for the Governor's Communications team:

1. **News Clips** — "How could we automate the process of identifying mentions of Governor Stein in the news and collecting the outlet, title, first paragraph, and first mention of Governor Stein in the article? Is there a way to use AI for proofreading of faulty transcripts?"

2. **Remarks Search** — "How could we create a useful search + retrieval function for existing language on a given topic? For example, what is the language we've used to talk about clean tech across a variety of remarks?"

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
- **No secrets in app settings** — every Function App setting is an endpoint URL. The only secret (Bing API key) lives in Key Vault and is fetched at runtime via the SDK.
- **Post-deploy manual step** — the Function host key has to be copied into Key Vault after the first deployment so APIM can inject it

### Workstream 2: Function App Core + Proofread
Created the TypeScript project scaffold (package.json, tsconfig.json, host.json), shared utility modules (OpenAI, AI Search, Cosmos singletons), and the transcript proofread function as a fully working Phase 1 deliverable.

Key pattern: `AzureOpenAI` is imported from the `openai` package (not `@azure/openai`), using `getBearerTokenProvider` from `@azure/identity` for managed identity auth. This is the current recommended pattern from Microsoft's SDK docs.

### Workstream 3: Clips + Remarks Functions
Built all five remaining functions:
- `clips-ingest.ts` — Timer-triggered Bing News Search with SHA-256 dedup
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
- **Bing News API key:** Clips timer ingestion is deployed but won't run until a Bing News Search API key is added to Key Vault.

### Result

All 3 capabilities tested and working end-to-end through APIM. The platform is ready for Copilot Studio integration (Phase 4).

---

*More chapters will be added as implementation progresses.*
