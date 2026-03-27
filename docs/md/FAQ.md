# FAQ — NC DIT AI Office Agent

## General

### What does this tool do?
It gives the Governor's Communications Office a conversational AI assistant in Microsoft Teams that can:
1. Automatically track news mentions of Governor Stein
2. Search historical remarks/speeches by topic and retrieve exact language used
3. Proofread faulty transcripts

### Who is this for?
Communications staff in the NC Governor's Office who currently do manual news clipping and remarks research.

### Where do I access it?
Through Microsoft Teams — search for the agent by name in the Teams chat, or it can be pinned to your Teams sidebar.

---

## News Clips

### How often are clips updated?
The system checks for new articles daily at 7 AM Eastern. You can also force an immediate refresh using the "Refresh Clips" button in the web demo.

### What sources does it monitor?
Two sources run in parallel on each ingestion cycle:
1. **Governor's press releases** — scrapes governor.nc.gov/news/press-releases (first 2 pages, ~20 articles)
2. **External media** — searches the web via Azure OpenAI's Responses API with Bing grounding to find coverage from outlets like WRAL, News & Observer, Charlotte Observer, AP News, and others

Results are merged and deduplicated by URL. The clips index currently has 30 clips (23 NC Governor + 7 external media). Bing Search v7 APIs are retired; the Responses API `web_search` tool is the replacement and requires no separate Azure resource — it uses the existing Azure OpenAI resource.

### Can I get a daily email summary?
Not yet — the daily digest HTML generation is built, but email delivery is not yet wired up. This will require a Logic App or SendGrid integration.

---

## Remarks Search

### What remarks are searchable?
All remarks that have been uploaded to the system. The initial load includes the full historical corpus; new remarks are indexed automatically when uploaded.

### How do I add new remarks?
Upload the document (Word, PDF, or plain text) to the designated SharePoint library. It will be automatically chunked, embedded, and indexed.

### How accurate are the AI-generated summaries?
The system always includes direct quotes with citations (date, event). The AI synthesis is grounded in the actual text — it will not fabricate language that doesn't exist in the corpus.

---

## Transcript Proofreading

### What kinds of errors does it fix?
ASR (speech-to-text) and OCR artifacts: homophones, garbled words, missing punctuation, malformed speaker labels. It preserves original meaning and flags uncertain corrections with `[?]`.

### Can I trust the corrections?
The system is conservative — it fixes obvious errors and flags anything uncertain. Always review the output before publishing.

---

## Technical

### How does Copilot Studio connect to the backend?
A Power Platform custom connector bridges Copilot Studio and the APIM gateway. The connector is deployed to the GCC (Government Community Cloud) Power Platform environment (`og-ai`). It exposes three tools — QueryClips, QueryRemarks, and ProofreadTranscript — and authenticates with an APIM subscription key. The agent uses **generative orchestration**, so it automatically selects the right tool based on the user's intent — no manual topic configuration needed.

### Is my data secure?
All data stays within the NC DIT Azure tenant. Authentication is via Entra ID (SSO). External calls are limited to governor.nc.gov (press release scraping) and the Azure OpenAI Responses API with Bing grounding (web news search) — no internal data leaves the environment. All service-to-service auth uses managed identity — no API keys or connection strings in application code. The Power Platform connector runs in a GCC environment, meeting government compliance requirements. Both Blob Storage and Cosmos DB have public network access disabled and are only accessible via VNet private endpoints.

### What does it cost to run?
Approximately $120–195/month at steady state (includes always-ready instances to eliminate cold starts). See [ARCHITECTURE.md](./ARCHITECTURE.md#cost-estimate-monthly-steady-state) for the breakdown.

### What file formats can I upload for remarks?
Currently `.txt` files are fully supported. `.docx` (Word) and `.pdf` support is planned — the ingestion pipeline is built but the text extraction libraries need to be wired in.

### What are the API endpoints?
All three endpoints are live and tested through the APIM gateway at `https://nc-comms-agent-dev-apim.azure-api.net/comms`:
- `POST /clips/query` — search/browse news clips
- `POST /remarks/query` — semantic search over remarks (with RAG synthesis)
- `POST /proofread` — transcript proofreading

All requests require an `Ocp-Apim-Subscription-Key` header.

### What happens if the news ingestion fails?
The system processes articles individually. If one article fails to process, it logs the error and continues with the rest. Failed articles will be retried on the next scheduled run (or via manual refresh) since the scraper re-checks the same press release pages.

### Was there a known issue with clips ingestion?
Two dedup bugs were found and fixed:

1. **Fixed 2026-03-24** — The `@azure/cosmos` v4 SDK returns `"NotFound"` (string) on `ErrorResponse.code`, but the dedup check was comparing against `404` (number). Every new clip was treated as an unexpected error and skipped. The fix checked for both values.

2. **Fixed 2026-03-26** — The Cosmos SDK v4 `.read()` method returns `statusCode: 404` for missing items instead of throwing an exception. The dedup logic was rewritten to check `statusCode === 200 && existingClip` rather than using try/catch.

### How much does the web news search cost?
The Azure OpenAI Responses API with Bing grounding costs ~$0.035 per call ($35 per 1,000 calls). At once-daily ingestion, this adds ~$1/month. No separate Bing Search resource is needed — web search is built into the existing Azure OpenAI resource.

### Is there a web demo outside of Teams?
Yes — `demo.html` + `demo-server.js` provide a standalone browser-based demo. Run `node demo-server.js` (port 9090) with the `APIM_SUBSCRIPTION_KEY` environment variable set. This is useful for testing and demos outside of the Copilot Studio / Teams environment.
