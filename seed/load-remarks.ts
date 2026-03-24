/**
 * Seed script: manually processes a remarks .txt file — chunks, embeds, stores in Cosmos DB,
 * and indexes into AI Search. Bypasses the blob trigger for seeding.
 *
 * Usage:
 *   COSMOS_DB_ENDPOINT=... AZURE_OPENAI_ENDPOINT=... AZURE_AI_SEARCH_ENDPOINT=... \
 *     AZURE_AI_SEARCH_ADMIN_KEY=... npx tsx seed/load-remarks.ts <path-to-txt-file>
 */

import { readFileSync } from "fs";
import { basename, resolve } from "path";
import { CosmosClient } from "@azure/cosmos";
import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { AzureOpenAI } from "openai";

const COSMOS_ENDPOINT = process.env.COSMOS_DB_ENDPOINT;
const OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const SEARCH_ENDPOINT = process.env.AZURE_AI_SEARCH_ENDPOINT ?? "https://nc-comms-agent-dev-search.search.windows.net";
const SEARCH_ADMIN_KEY = process.env.AZURE_AI_SEARCH_ADMIN_KEY;
const EMBEDDING_DEPLOYMENT = process.env.EMBEDDING_DEPLOYMENT_NAME ?? "text-embedding-3-large";
const DATABASE_NAME = "comms-agent";
const MIN_CHUNK_CHARS = 200;
const MAX_CHUNK_CHARS = 1000;

function parseFilename(fileName: string): { date: string; event: string; venue: string } {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const parts = baseName.split("_");
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const date = parts[0] && datePattern.test(parts[0]) ? parts[0] : new Date().toISOString().slice(0, 10);
  const event = parts[1]?.replace(/-/g, " ") ?? "Unknown Event";
  const venue = parts[2]?.replace(/-/g, " ") ?? "Unknown Venue";
  return { date, event, venue };
}

function chunkText(text: string): string[] {
  const rawParagraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of rawParagraphs) {
    if (current.length + paragraph.length + 1 > MAX_CHUNK_CHARS && current.length >= MIN_CHUNK_CHARS) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current += (current ? "\n\n" : "") + paragraph;
    }
  }

  if (current.trim().length > 0) {
    if (current.trim().length < MIN_CHUNK_CHARS && chunks.length > 0) {
      const last = chunks.pop()!;
      chunks.push(`${last}\n\n${current.trim()}`);
    } else {
      chunks.push(current.trim());
    }
  }

  return chunks;
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx seed/load-remarks.ts <path-to-txt-file>");
    process.exit(1);
  }
  if (!COSMOS_ENDPOINT || !OPENAI_ENDPOINT) {
    console.error("Missing COSMOS_DB_ENDPOINT or AZURE_OPENAI_ENDPOINT env var");
    process.exit(1);
  }

  const fullPath = resolve(filePath);
  const fileName = basename(fullPath);
  const text = readFileSync(fullPath, "utf-8");
  const { date, event, venue } = parseFilename(fileName);
  const remarkId = `remarks-${date}-${event.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`;
  const title = `${event} — ${date}`;

  console.log(`File: ${fileName}`);
  console.log(`Remark ID: ${remarkId}`);
  console.log(`Title: ${title} | Date: ${date} | Event: ${event} | Venue: ${venue}`);

  const chunks = chunkText(text);
  console.log(`Chunks: ${chunks.length}`);

  const credential = new DefaultAzureCredential();

  // Cosmos client
  const cosmos = new CosmosClient({ endpoint: COSMOS_ENDPOINT, aadCredentials: credential });
  const metaContainer = cosmos.database(DATABASE_NAME).container("remarks-metadata");
  const chunksContainer = cosmos.database(DATABASE_NAME).container("remarks-chunks");

  // OpenAI client
  const tokenProvider = getBearerTokenProvider(credential, "https://cognitiveservices.azure.com/.default");
  const openai = new AzureOpenAI({ azureADTokenProvider: tokenProvider, endpoint: OPENAI_ENDPOINT, apiVersion: "2024-10-21" });

  // Search client
  const searchCredential = SEARCH_ADMIN_KEY ? new AzureKeyCredential(SEARCH_ADMIN_KEY) : credential;
  const searchClient = new SearchClient(SEARCH_ENDPOINT, "remarks", searchCredential as any);

  // Store metadata
  await metaContainer.items.upsert({
    id: remarkId,
    title,
    date,
    event,
    venue,
    chunkCount: chunks.length,
    sourceFile: fileName,
    ingestedAt: new Date().toISOString(),
  });
  console.log("Metadata stored");

  // Process chunks
  const searchDocs: any[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = `${remarkId}-chunk-${String(i).padStart(3, "0")}`;
    console.log(`  Embedding chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`);

    const embeddingResponse = await openai.embeddings.create({ model: EMBEDDING_DEPLOYMENT, input: chunks[i] });
    const embedding = embeddingResponse.data[0].embedding;

    const doc = {
      id: chunkId,
      remarkId,
      title,
      date,
      event,
      venue,
      chunkIndex: i,
      chunkText: chunks[i],
      topicTags: [],
      embedding,
    };

    await chunksContainer.items.upsert(doc);
    searchDocs.push(doc);
  }

  console.log(`All ${chunks.length} chunks stored in Cosmos DB`);

  // Index into AI Search
  try {
    const result = await searchClient.mergeOrUploadDocuments(searchDocs);
    const succeeded = result.results.filter((r) => r.succeeded).length;
    console.log(`AI Search: ${succeeded}/${searchDocs.length} indexed`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`AI Search indexing failed: ${msg}`);
    console.log("Chunks are in Cosmos DB — you can index later.");
  }

  console.log("Done!");
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
