/**
 * Reads all clips from Cosmos DB and pushes them into the AI Search "clips" index.
 *
 * Usage:
 *   COSMOS_DB_ENDPOINT=https://... AZURE_AI_SEARCH_ENDPOINT=https://... npx tsx seed/index-clips-to-search.ts
 *
 * Requires:
 *   - Azure CLI login (DefaultAzureCredential)
 */

import { CosmosClient } from "@azure/cosmos";
import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import { DefaultAzureCredential } from "@azure/identity";

const COSMOS_ENDPOINT = process.env.COSMOS_DB_ENDPOINT;
const SEARCH_ENDPOINT =
  process.env.AZURE_AI_SEARCH_ENDPOINT ??
  "https://nc-comms-agent-dev-search.search.windows.net";

const DATABASE_NAME = "comms-agent";
const CONTAINER_NAME = "clips";
const INDEX_NAME = "clips";
const BATCH_SIZE = 1000;

interface ClipDocument {
  id: string;
  url: string;
  outlet: string;
  title: string;
  publishedAt: string;
  lede: string;
  mentionContext: string;
  mentionOffset: number;
  fullText: string;
  ingestedAt: string;
  embedding?: number[];
  [key: string]: unknown;
}

async function main(): Promise<void> {
  if (!COSMOS_ENDPOINT) {
    console.error("Missing COSMOS_DB_ENDPOINT env var");
    process.exit(1);
  }

  console.log(`Cosmos endpoint:  ${COSMOS_ENDPOINT}`);
  console.log(`Search endpoint:  ${SEARCH_ENDPOINT}`);
  console.log(`Index:            ${INDEX_NAME}`);

  const credential = new DefaultAzureCredential();

  // Cosmos client
  const cosmos = new CosmosClient({ endpoint: COSMOS_ENDPOINT, aadCredentials: credential });
  const container = cosmos.database(DATABASE_NAME).container(CONTAINER_NAME);

  // Search client — use API key if provided (RBAC propagation can be slow), otherwise DefaultAzureCredential
  const searchApiKey = process.env.AZURE_AI_SEARCH_ADMIN_KEY;
  const searchCredential = searchApiKey
    ? new AzureKeyCredential(searchApiKey)
    : credential;
  const searchClient = new SearchClient<ClipDocument>(
    SEARCH_ENDPOINT,
    INDEX_NAME,
    searchCredential as any
  );

  // Read all clips from Cosmos
  console.log("\nReading clips from Cosmos DB...");
  const { resources: clips } = await container.items
    .query<ClipDocument>("SELECT * FROM c")
    .fetchAll();

  console.log(`Found ${clips.length} clips in Cosmos DB`);

  if (clips.length === 0) {
    console.log("Nothing to index.");
    return;
  }

  // Upload in batches
  let indexed = 0;
  let failed = 0;

  for (let i = 0; i < clips.length; i += BATCH_SIZE) {
    const batch = clips.slice(i, i + BATCH_SIZE);

    // Map to search-index shape (passthrough, but strip Cosmos metadata)
    const documents: ClipDocument[] = batch.map((clip) => ({
      id: clip.id,
      url: clip.url,
      outlet: clip.outlet,
      title: clip.title,
      publishedAt: clip.publishedAt,
      lede: clip.lede,
      mentionContext: clip.mentionContext,
      mentionOffset: clip.mentionOffset,
      fullText: clip.fullText,
      ingestedAt: clip.ingestedAt,
      embedding: clip.embedding,
    }));

    try {
      const result = await searchClient.mergeOrUploadDocuments(documents).catch((err) => {
        console.error(`  Upload error:`, JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
        throw err;
      });

      const succeeded = result.results.filter((r) => r.succeeded).length;
      const batchFailed = result.results.filter((r) => !r.succeeded).length;
      indexed += succeeded;
      failed += batchFailed;

      if (batchFailed > 0) {
        for (const r of result.results) {
          if (!r.succeeded) {
            console.error(`  FAIL doc "${r.key}": ${r.errorMessage}`);
          }
        }
      }

      console.log(
        `  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${succeeded} indexed, ${batchFailed} failed`
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} FAILED: ${message}`);
      failed += batch.length;
    }
  }

  console.log(`\nDone: ${indexed} indexed, ${failed} failed (${clips.length} total)`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
