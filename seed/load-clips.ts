/**
 * Seed script: loads clips.json into Cosmos DB and generates embeddings.
 *
 * Usage:
 *   npx tsx seed/load-clips.ts
 *
 * Requires:
 *   - AZURE_OPENAI_ENDPOINT env var
 *   - COSMOS_DB_ENDPOINT env var
 *   - Azure CLI login (DefaultAzureCredential)
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import * as crypto from "crypto";
import { CosmosClient } from "@azure/cosmos";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { AzureOpenAI } from "openai";

const COSMOS_ENDPOINT = process.env.COSMOS_DB_ENDPOINT;
const OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const EMBEDDING_DEPLOYMENT = process.env.EMBEDDING_DEPLOYMENT_NAME ?? "text-embedding-3-large";
const DATABASE_NAME = "comms-agent";
const CONTAINER_NAME = "clips";

interface SeedClip {
  url: string;
  outlet: string;
  title: string;
  publishedAt: string;
  lede: string;
  mentionContext: string;
  fullText: string;
  topics: string[];
}

async function main(): Promise<void> {
  if (!COSMOS_ENDPOINT) {
    console.error("Missing COSMOS_DB_ENDPOINT env var");
    process.exit(1);
  }
  if (!OPENAI_ENDPOINT) {
    console.error("Missing AZURE_OPENAI_ENDPOINT env var");
    process.exit(1);
  }

  // Load seed data
  const seedPath = resolve(__dirname, "clips.json");
  const clips: SeedClip[] = JSON.parse(readFileSync(seedPath, "utf-8"));
  console.log(`Loaded ${clips.length} clips from seed file`);

  // Init clients
  const credential = new DefaultAzureCredential();

  const cosmos = new CosmosClient({ endpoint: COSMOS_ENDPOINT, aadCredentials: credential });
  const container = cosmos.database(DATABASE_NAME).container(CONTAINER_NAME);

  const tokenProvider = getBearerTokenProvider(
    credential,
    "https://cognitiveservices.azure.com/.default"
  );
  const openai = new AzureOpenAI({
    azureADTokenProvider: tokenProvider,
    endpoint: OPENAI_ENDPOINT,
    apiVersion: "2024-10-21",
  });

  let loaded = 0;
  let skipped = 0;

  for (const clip of clips) {
    const id = crypto.createHash("sha256").update(clip.url).digest("hex");

    // Check if already exists
    try {
      const { resource, statusCode } = await container.item(id, id).read();
      if (resource && statusCode !== 404) {
        console.log(`  SKIP (exists): ${clip.title}`);
        skipped++;
        continue;
      }
    } catch {
      // 404 or other error — proceed to create
    }

    // Generate embedding
    const embeddingText = `${clip.title}. ${clip.lede}`;
    console.log(`  Embedding: ${clip.title.slice(0, 60)}...`);
    const embeddingResponse = await openai.embeddings.create({
      model: EMBEDDING_DEPLOYMENT,
      input: embeddingText,
    });
    const embedding = embeddingResponse.data[0].embedding;

    // Build document
    const doc = {
      id,
      url: clip.url,
      outlet: clip.outlet,
      title: clip.title,
      publishedAt: clip.publishedAt,
      lede: clip.lede,
      mentionContext: clip.mentionContext,
      mentionOffset: clip.fullText.indexOf(clip.mentionContext),
      fullText: clip.fullText,
      ingestedAt: new Date().toISOString(),
      embedding,
      topics: clip.topics,
    };

    await container.items.create(doc);
    console.log(`  LOADED: ${clip.title}`);
    loaded++;
  }

  console.log(`\nDone: ${loaded} loaded, ${skipped} skipped`);
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
