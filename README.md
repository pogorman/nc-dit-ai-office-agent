# NC DIT AI Office Agent

AI-powered tool for the North Carolina Governor's Communications Office that automates news clip monitoring and provides semantic search over historical remarks — delivered as a conversational agent in Microsoft Teams via Copilot Studio.

## Capabilities

| Capability | Description | Status |
|---|---|---|
| **Transcript Proofreading** | AI-powered cleanup of faulty ASR/OCR transcripts | Fully implemented |
| **Remarks Search** | Semantic search + RAG synthesis across the Governor's remarks corpus | Implemented (`.txt` ingestion; `.docx`/`.pdf` stubbed) |
| **News Clips** | Automated monitoring of Governor press releases via governor.nc.gov scraping | Implemented (dedup bug fixed 2026-03-24; runs daily at 7 AM ET + manual refresh button) |
| **Daily Digest** | Weekday morning email summary of new clips | Stubbed (email sending TBD) |

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full system design, data models, Copilot Studio agent topology, and cost estimates.

**Stack:**
- **Runtime:** TypeScript on Azure Functions v4 (Flex Consumption), Node.js 20
- **Gateway:** Azure API Management (Consumption tier)
- **Search:** Azure AI Search (Basic, hybrid vector + BM25)
- **AI:** Azure OpenAI (GPT-4o + text-embedding-3-large)
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
│   ├── functions/            Azure Functions (6 functions)
│   │   ├── proofread.ts          POST /api/proofread
│   │   ├── clips-ingest.ts       Timer (7 AM ET daily) + POST /api/clips/refresh
│   │   ├── clips-query.ts        POST /api/clips/query
│   │   ├── clips-digest.ts       Timer (8 AM weekdays)
│   │   ├── remarks-ingest.ts     Blob trigger (remarks-uploads)
│   │   └── remarks-query.ts      POST /api/remarks/query
│   └── shared/               Singleton clients + types
│       ├── types.ts
│       ├── openai-client.ts
│       ├── search-client.ts
│       └── cosmos-client.ts
├── connector/                Power Platform custom connector
│   ├── apiDefinition.swagger.json   OpenAPI 2.0 spec (3 actions)
│   └── apiProperties.json           Connector metadata + auth config
├── seed/                     Data seeding & index creation scripts
│   └── remarks/              7 seeded remarks (State of State + 6 monthly columns)
├── docs/
│   ├── demo-questions.pptx       Demo questions PowerPoint
│   ├── presentation.pptx         8-slide presentation PowerPoint
│   ├── build-demo-pptx.py        Regenerate demo-questions.pptx
│   ├── build-presentation-pptx.py Regenerate presentation.pptx
│   ├── html/                 Printable HTML guides, presentation, talk track, demo UI
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
| `https://nc-comms-agent-dev-apim.azure-api.net/comms/clips/refresh` | POST | Force clips re-ingestion (TODO: add to APIM) |
| `https://nc-comms-agent-dev-apim.azure-api.net/comms/remarks/query` | POST | Semantic search over remarks (RAG) |
| `https://nc-comms-agent-dev-apim.azure-api.net/comms/proofread` | POST | Transcript proofreading |

Auth: `Ocp-Apim-Subscription-Key` header with APIM subscription key.

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

Three tools are deployed:
- **QueryClips** — search/browse news clips
- **QueryRemarks** — semantic search over remarks with RAG synthesis
- **ProofreadTranscript** — AI-powered transcript cleanup

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
