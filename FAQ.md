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
Bing News Search, which covers major national outlets and NC regional sources. The source list can be expanded with curated RSS feeds.

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
All data stays within the NC DIT Azure tenant. Authentication is via Entra ID (SSO). No data leaves the Azure environment except for Bing News Search queries (which are search terms only, not internal data). All service-to-service auth uses managed identity — no API keys or connection strings in application code. The only secret (Bing News API key) is stored in Azure Key Vault. The Power Platform connector runs in a GCC environment, meeting government compliance requirements. Blob Storage has public network access disabled and is only accessible via a VNet private endpoint.

### What does it cost to run?
Approximately $155–230/month at steady state (includes always-ready instances to eliminate cold starts). See [ARCHITECTURE.md](./ARCHITECTURE.md#cost-estimate-monthly-steady-state) for the breakdown.

### What file formats can I upload for remarks?
Currently `.txt` files are fully supported. `.docx` (Word) and `.pdf` support is planned — the ingestion pipeline is built but the text extraction libraries need to be wired in.

### What are the API endpoints?
All three endpoints are live and tested through the APIM gateway at `https://nc-comms-agent-dev-apim.azure-api.net/comms`:
- `POST /clips/query` — search/browse news clips
- `POST /remarks/query` — semantic search over remarks (with RAG synthesis)
- `POST /proofread` — transcript proofreading

All requests require an `Ocp-Apim-Subscription-Key` header.

### What happens if the news ingestion fails?
The system processes articles individually. If one article fails to process, it logs the error and continues with the rest. Failed articles will be retried on the next 15-minute cycle if they're still in the Bing results.
