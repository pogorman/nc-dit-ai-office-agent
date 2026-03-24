/**
 * Creates or updates AI Search indexes for clips and remarks.
 *
 * Usage:
 *   AZURE_AI_SEARCH_ENDPOINT=https://nc-comms-agent-dev-search.search.windows.net npx tsx seed/create-search-indexes.ts
 *
 * Requires:
 *   - Azure CLI login (DefaultAzureCredential)
 */

import {
  SearchIndexClient,
  SearchIndex,
  SearchField,
} from "@azure/search-documents";
import { DefaultAzureCredential } from "@azure/identity";

const SEARCH_ENDPOINT =
  process.env.AZURE_AI_SEARCH_ENDPOINT ??
  "https://nc-comms-agent-dev-search.search.windows.net";

// ---------------------------------------------------------------------------
// clips index
// ---------------------------------------------------------------------------

const clipsIndex: SearchIndex = {
  name: "clips",
  fields: [
    { name: "id", type: "Edm.String", key: true, filterable: true } as SearchField,
    { name: "url", type: "Edm.String" } as SearchField,
    { name: "outlet", type: "Edm.String", filterable: true, facetable: true } as SearchField,
    { name: "title", type: "Edm.String", searchable: true } as SearchField,
    {
      name: "publishedAt",
      type: "Edm.DateTimeOffset",
      filterable: true,
      sortable: true,
    } as SearchField,
    { name: "lede", type: "Edm.String", searchable: true } as SearchField,
    { name: "mentionContext", type: "Edm.String", searchable: true } as SearchField,
    { name: "mentionOffset", type: "Edm.Int32" } as SearchField,
    { name: "fullText", type: "Edm.String", searchable: true } as SearchField,
    {
      name: "ingestedAt",
      type: "Edm.DateTimeOffset",
      filterable: true,
      sortable: true,
    } as SearchField,
    {
      name: "embedding",
      type: "Collection(Edm.Single)",
      searchable: true,
      vectorSearchDimensions: 3072,
      vectorSearchProfileName: "clips-vector-profile",
    } as SearchField,
  ],
  vectorSearch: {
    algorithms: [{ name: "clips-hnsw", kind: "hnsw" }],
    profiles: [{ name: "clips-vector-profile", algorithmConfigurationName: "clips-hnsw" }],
  },
  semanticSearch: {
    configurations: [
      {
        name: "clips-semantic",
        prioritizedFields: {
          titleField: { name: "title" },
          contentFields: [
            { name: "fullText" },
            { name: "lede" },
            { name: "mentionContext" },
          ],
          keywordsFields: [{ name: "outlet" }],
        },
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// remarks index
// ---------------------------------------------------------------------------

const remarksIndex: SearchIndex = {
  name: "remarks",
  fields: [
    { name: "id", type: "Edm.String", key: true, filterable: true } as SearchField,
    { name: "remarkId", type: "Edm.String", filterable: true } as SearchField,
    {
      name: "title",
      type: "Edm.String",
      searchable: true,
      filterable: true,
    } as SearchField,
    { name: "date", type: "Edm.String", filterable: true, sortable: true } as SearchField,
    {
      name: "event",
      type: "Edm.String",
      searchable: true,
      filterable: true,
      facetable: true,
    } as SearchField,
    {
      name: "venue",
      type: "Edm.String",
      searchable: true,
      filterable: true,
    } as SearchField,
    { name: "chunkIndex", type: "Edm.Int32", sortable: true } as SearchField,
    { name: "chunkText", type: "Edm.String", searchable: true } as SearchField,
    {
      name: "topicTags",
      type: "Collection(Edm.String)",
      filterable: true,
      facetable: true,
    } as SearchField,
    {
      name: "embedding",
      type: "Collection(Edm.Single)",
      searchable: true,
      vectorSearchDimensions: 3072,
      vectorSearchProfileName: "remarks-vector-profile",
    } as SearchField,
  ],
  vectorSearch: {
    algorithms: [{ name: "remarks-hnsw", kind: "hnsw" }],
    profiles: [{ name: "remarks-vector-profile", algorithmConfigurationName: "remarks-hnsw" }],
  },
  semanticSearch: {
    configurations: [
      {
        name: "remarks-semantic",
        prioritizedFields: {
          titleField: { name: "title" },
          contentFields: [{ name: "chunkText" }],
          keywordsFields: [{ name: "event" }, { name: "venue" }],
        },
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Search endpoint: ${SEARCH_ENDPOINT}`);

  const credential = new DefaultAzureCredential();
  const indexClient = new SearchIndexClient(SEARCH_ENDPOINT, credential);

  const indexes = [clipsIndex, remarksIndex];

  for (const index of indexes) {
    try {
      await indexClient.createOrUpdateIndex(index);
      console.log(`OK  — index "${index.name}" created/updated`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`FAIL — index "${index.name}": ${message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
