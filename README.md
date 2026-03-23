# NC DIT AI Office Agent

AI-powered tool for the North Carolina Governor's Communications Office that automates news clip monitoring and provides semantic search over historical remarks — delivered as a conversational agent in Microsoft Teams via Copilot Studio.

## Capabilities

| Capability | Description | Status |
|---|---|---|
| **Transcript Proofreading** | AI-powered cleanup of faulty ASR/OCR transcripts | Fully implemented |
| **Remarks Search** | Semantic search + RAG synthesis across the Governor's remarks corpus | Implemented (`.txt` ingestion; `.docx`/`.pdf` stubbed) |
| **News Clips** | Automated monitoring for Governor Stein mentions via Bing News Search | Implemented |
| **Daily Digest** | Weekday morning email summary of new clips | Stubbed (email sending TBD) |

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full system design, data models, Copilot Studio agent topology, and cost estimates.

**Stack:**
- **Runtime:** TypeScript on Azure Functions v4 (Flex Consumption), Node.js 20
- **Gateway:** Azure API Management (Consumption tier)
- **Search:** Azure AI Search (Basic, hybrid vector + BM25)
- **AI:** Azure OpenAI (GPT-4o + text-embedding-3-large)
- **Storage:** Cosmos DB (Serverless) for clips/metadata, Blob Storage for remarks uploads
- **Secrets:** Azure Key Vault (RBAC mode)
- **Agent:** Microsoft Copilot Studio (Teams / web / SharePoint embed)
- **IaC:** Bicep (modular, 8 resource modules)

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

> **Post-deploy:** Copy the Function App host key into Key Vault as `function-host-key` so APIM can inject it at the gateway.

## Project Structure

```
├── infra/                    Bicep IaC (8 resource modules)
├── src/
│   ├── functions/            Azure Functions (6 functions)
│   │   ├── proofread.ts          POST /api/proofread
│   │   ├── clips-ingest.ts       Timer (every 15 min)
│   │   ├── clips-query.ts        POST /api/clips/query
│   │   ├── clips-digest.ts       Timer (8 AM weekdays)
│   │   ├── remarks-ingest.ts     Blob trigger (remarks-uploads)
│   │   └── remarks-query.ts      POST /api/remarks/query
│   └── shared/               Singleton clients + types
│       ├── types.ts
│       ├── openai-client.ts
│       ├── search-client.ts
│       └── cosmos-client.ts
├── package.json
├── tsconfig.json
├── host.json
└── .env.example
```

## Project Documentation

| Document | Description |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design, data models, auth matrix, phasing, cost estimate |
| [FAQ.md](./FAQ.md) | Frequently asked questions (stakeholder + technical) |
| [USER-GUIDE.md](./USER-GUIDE.md) | End-user guide for comms staff |
| [HOW-I-WAS-BUILT.md](./HOW-I-WAS-BUILT.md) | Build journal with prompts and decisions |
