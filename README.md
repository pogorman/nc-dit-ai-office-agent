# NC DIT AI Office Agent

AI-powered tool for the North Carolina Governor's Communications Office that automates news clip monitoring and provides semantic search over historical remarks — delivered as a conversational agent in Microsoft Teams via Copilot Studio, with a React dashboard for operational visibility.

## Capabilities

| Capability | Description | Status |
|---|---|---|
| **Transcript Proofreading** | AI-powered cleanup of faulty ASR/OCR transcripts | Fully implemented |
| **Transcription** | Audio/video transcription via Azure OpenAI Whisper (mp3, mp4, wav, webm, etc.) | Fully implemented |
| **Remarks Search** | Semantic search + RAG synthesis across the Governor's remarks corpus | Implemented (`.txt` ingestion; `.docx`/`.pdf` stubbed) |
| **News Clips** | Automated monitoring via governor.nc.gov scraping + multi-query web search (5 focused queries via Azure OpenAI Responses API with Bing grounding) | Implemented (118 clips across 40+ outlets; runs daily at 7 AM ET + manual refresh) |
| **Dashboard** | React SPA with stats overview, clip browser, remarks list, and ingestion run history | Fully implemented |
| **Daily Digest** | Weekday morning email summary of new clips | Stubbed (email sending TBD) |

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full system design, data models, Copilot Studio agent topology, and cost estimates.

**Stack:**
- **Runtime:** TypeScript on Azure Functions v4 (Flex Consumption), Node.js 20
- **Gateway:** Azure API Management (Consumption tier)
- **Search:** Azure AI Search (Basic, hybrid vector + BM25)
- **AI:** Azure OpenAI (GPT-5-chat for synthesis/proofread + text-embedding-3-large + Whisper + Responses API with Bing grounding for multi-query web news search)
- **Dashboard:** React 19 + Vite 8 + Tailwind CSS v4 (TypeScript strict mode)
- **Storage:** Cosmos DB (Serverless) for clips/metadata, Blob Storage for remarks uploads
- **Secrets:** Azure Key Vault (RBAC mode) — Function host key for APIM (no external API keys needed)
- **Agent:** Microsoft Copilot Studio (Teams / web / SharePoint embed)
- **Networking:** VNet with private endpoints for Blob Storage and Cosmos DB; Function App VNet integration
- **Connector:** Power Platform custom connector (OpenAPI 2.0, deployed to GCC environment)
- **IaC:** Bicep (modular, 9 resource modules)
- **Reference Guides:** [Architecture Cheat Sheet](./docs/html/architecture-cheat-sheet.html) | [How It Works (ELI5)](./docs/html/how-it-works-guide.html)

## Prerequisites

- Node.js 20+
- Azure CLI
- Azure Functions Core Tools v4
- Azure subscription with OpenAI access
- Copilot Studio license (per-tenant)

## Getting Started

```bash
# Install dependencies
npm install

# Set up local environment
cp .env.example .env
# Fill in your Azure resource endpoints (see .env.example for the full list)

# Build
npm run build

# Run locally (builds first, then starts Azure Functions host)
npm run start

# Watch mode for development
npm run watch
```

### Deploy Infrastructure

```bash
# Deploy to Azure (requires Azure CLI login)
az deployment group create \
  --resource-group <your-rg> \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam
```

> **Post-deploy:** The APIM named value `function-host-key` is already configured with the Function App host key.
> **Networking:** Both Storage and Cosmos DB have `publicNetworkAccess: Disabled` with private endpoints. Deploying with `func azure functionapp publish` requires temporarily setting Storage `publicNetworkAccess: Enabled`, then setting it back to `Disabled` after the deploy completes. The `func` CLI cannot upload through the VNet from a local machine.

## Project Structure

```
├── infra/                    Bicep IaC (9 resource modules)
├── src/
│   ├── functions/            Azure Functions (8 functions)
│   │   ├── proofread.ts          POST /api/proofread
│   │   ├── transcribe.ts         POST /api/transcribe (Whisper audio/video transcription)
│   │   ├── clips-ingest.ts       Timer (7 AM ET daily) + POST /api/clips/refresh (gov scraper + web search)
│   │   ├── clips-query.ts        POST /api/clips/query
│   │   ├── clips-digest.ts       Timer (8 AM weekdays)
│   │   ├── dashboard.ts          GET /api/dashboard/{stats,clips,remarks,runs}
│   │   ├── remarks-ingest.ts     Blob trigger (remarks-uploads)
│   │   └── remarks-query.ts      POST /api/remarks/query
│   └── shared/               Singleton clients + types
│       ├── types.ts              NewsClip, RemarksChunk, IngestionRun, DashboardStats, TranscribeResponse, etc.
│       ├── openai-client.ts      AzureOpenAI singleton + webSearch() + transcribeAudio()
│       ├── search-client.ts
│       └── cosmos-client.ts
├── dashboard/                React SPA dashboard (Vite + Tailwind)
│   ├── src/
│   │   ├── App.tsx               Tab router (Overview, Clips, Remarks, Runs)
│   │   └── components/           StatsPanel, ClipsFeed, RemarksList, RunsHistory
│   ├── vite.config.ts            Dev proxy to APIM or direct Function App
│   ├── .env.example              VITE_APIM_BASE_URL, VITE_APIM_SUBSCRIPTION_KEY
│   └── package.json              React 19, Vite 8, Tailwind CSS v4
├── connector/                Power Platform custom connector
│   ├── apiDefinition.swagger.json   OpenAPI 2.0 spec (4 actions)
│   └── apiProperties.json           Connector metadata + auth config
├── seed/                     Data seeding & index creation scripts
│   └── remarks/              7 seeded remarks (State of the State + 6 monthly columns, 26+ chunks)
├── docs/
│   ├── demo-questions.pptx       Demo questions PowerPoint
│   ├── presentation.pptx         8-slide presentation PowerPoint
│   ├── build-demo-pptx.py        Regenerate demo-questions.pptx
│   ├── build-presentation-pptx.py Regenerate presentation.pptx
│   ├── html/                 Printable HTML guides, presentation, talk track, demo UI, Azure technical reference
│   ├── md/                   Markdown docs (ARCHITECTURE, FAQ, USER-GUIDE, etc.)
│   └── pdf/                  PDF exports (for printed handouts)
├── demo-server.js            Express proxy for SPA → APIM (port 9090)
├── package.json
├── tsconfig.json
├── host.json
└── .env.example
```

## APIM Endpoints

All endpoints are live and tested through the APIM gateway:

| Endpoint | Method | Description |
|---|---|---|
| `https://nc-comms-agent-dev-apim.azure-api.net/comms/clips/query` | POST | Search/browse news clips |
| `https://nc-comms-agent-dev-apim.azure-api.net/comms/clips/refresh` | POST | Force clips re-ingestion (gov scraper + web search) |
| `https://nc-comms-agent-dev-apim.azure-api.net/comms/remarks/query` | POST | Semantic search over remarks (RAG) |
| `https://nc-comms-agent-dev-apim.azure-api.net/comms/proofread` | POST | Transcript proofreading |
| `https://nc-comms-agent-dev-apim.azure-api.net/comms/transcribe` | POST | Audio/video transcription (Whisper) |
| `https://nc-comms-agent-dev-apim.azure-api.net/comms/dashboard/stats` | GET | Dashboard stats (clip count, outlet breakdown, latest run) |
| `https://nc-comms-agent-dev-apim.azure-api.net/comms/dashboard/clips` | GET | Paginated clips list (outlet/date filters) |
| `https://nc-comms-agent-dev-apim.azure-api.net/comms/dashboard/remarks` | GET | Remarks document list |
| `https://nc-comms-agent-dev-apim.azure-api.net/comms/dashboard/runs` | GET | Ingestion run history |

Auth: `Ocp-Apim-Subscription-Key` header with APIM subscription key.

## Dashboard

A React SPA dashboard (`/dashboard`) provides operational visibility into clips, remarks, and ingestion runs. Four tabs: Overview (stat cards, outlet breakdown bars, latest run status with auto-refresh), Clips (paginated list with outlet/date filters), Remarks (document table), Runs (ingestion run history with status badges).

```bash
cd dashboard
npm install
cp .env.example .env.local
# Edit .env.local — set VITE_APIM_SUBSCRIPTION_KEY (and optionally VITE_APIM_BASE_URL)
npm run dev
# Open http://localhost:5173
```

The Vite dev server proxies `/api` requests to APIM (or directly to the Function App if `VITE_APIM_BASE_URL` points to `*.azurewebsites.net`). No routing library, no state management library, no charting library — just React 19, Vite 8, and Tailwind CSS v4.

## SPA Demo

A standalone browser-based demo (`docs/html/demo.html` + `demo-server.js`) is available for testing outside of Copilot Studio. The server proxies requests to APIM and injects the subscription key from the `APIM_SUBSCRIPTION_KEY` environment variable.

```bash
# Set your APIM subscription key
export APIM_SUBSCRIPTION_KEY=your-key-here

# Start the demo server
node demo-server.js
# Open http://localhost:9090 in your browser
```

## Copilot Studio Agent

The Copilot Studio agent is **fully working** in the GCC Power Platform environment (`og-ai`). It uses **generative orchestration** — no manual topic configuration needed. The agent selects the right tool based on the operation descriptions in the OpenAPI spec.

Four tools are deployed via the custom connector:
- **QueryClips** — search/browse news clips
- **QueryRemarks** — semantic search over remarks with RAG synthesis
- **ProofreadTranscript** — AI-powered transcript cleanup
- **TranscribeFile** — audio/video transcription via Whisper

The dashboard endpoints are accessed directly (not through Copilot Studio).

The Power Platform custom connector (`/connector/`) bridges Copilot Studio to APIM.

## Project Documentation

| Document | Description |
|---|---|
| [ARCHITECTURE.md](./docs/md/ARCHITECTURE.md) | System design, data models, auth matrix, phasing, cost estimate |
| [FAQ.md](./docs/md/FAQ.md) | Frequently asked questions (stakeholder + technical) |
| [USER-GUIDE.md](./docs/md/USER-GUIDE.md) | End-user guide for comms staff |
| [HOW-I-WAS-BUILT.md](./docs/md/HOW-I-WAS-BUILT.md) | Build journal with prompts and decisions |
| [Architecture Cheat Sheet](./docs/html/architecture-cheat-sheet.html) | One-pager: why each Azure service was chosen |
| [How It Works Guide](./docs/html/how-it-works-guide.html) | ELI5 guide for narrating the architecture to non-technical audiences |
| [Presentation (HTML)](./docs/html/presentation.html) | 5-slide demo deck (open in browser, F11 fullscreen) |
| [Presentation (PPTX)](./docs/html/presentation.pptx) | 8-slide PowerPoint (5 capability + 3 architecture diagrams) |
| [Demo Questions (HTML)](./docs/html/demo-questions.html) | Sample prompts for live demo — 5 clips, 5 remarks, 2 proofread |
| [Demo Questions (PPTX)](./docs/demo-questions.pptx) | PowerPoint version of demo questions |
| [Talk Track](./docs/html/talk-track.html) | 1-page speaker guide with timing + demo moments |
| [Azure Technical Reference](./docs/html/azure-technical-reference.html) | Comprehensive Azure reference: resource inventory, Bicep modules, Function deep dives, shared modules, data architecture, RBAC matrix, deployment checklist |
| [Model Quality Comparison](./docs/model-quality-comparison.html) | 4-column comparison: GPT-4o vs GPT-5-chat vs Copilot Studio generative vs classic |
