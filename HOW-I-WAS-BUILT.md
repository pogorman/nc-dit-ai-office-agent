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

*More chapters will be added as implementation progresses.*
