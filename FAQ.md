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
The system checks for new articles every 15 minutes.

### What sources does it monitor?
The system scrapes the Governor's official press releases page (governor.nc.gov/news/press-releases) directly. It checks the first 2 pages (~20 articles) every 15 minutes. Additional sources (curated RSS feeds) can be added. Bing Search API is retired and no longer available for new deployments.

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
All data stays within the NC DIT Azure tenant. Authentication is via Entra ID (SSO). The only external call is to governor.nc.gov to scrape press releases — no internal data leaves the environment. All service-to-service auth uses managed identity — no API keys or connection strings in application code. The Power Platform connector runs in a GCC environment, meeting government compliance requirements. Both Blob Storage and Cosmos DB have public network access disabled and are only accessible via VNet private endpoints.

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
The system processes articles individually. If one article fails to process, it logs the error and continues with the rest. Failed articles will be retried on the next 15-minute cycle since the scraper re-checks the same press release pages.

### Is there a known issue with clips ingestion?
Yes — the timer function successfully scrapes new articles from governor.nc.gov but currently fails silently when writing to Cosmos DB. This is under investigation and likely related to Cosmos write permissions or VNet outbound routing after the Cosmos DB private endpoint was added. The 10 seeded clips are unaffected and fully searchable. Application Insights needs to be configured for diagnostics.

### Is there a web demo outside of Teams?
Yes — `demo.html` + `demo-server.js` provide a standalone browser-based demo. Run `node demo-server.js` (port 9090) with the `APIM_SUBSCRIPTION_KEY` environment variable set. This is useful for testing and demos outside of the Copilot Studio / Teams environment.
