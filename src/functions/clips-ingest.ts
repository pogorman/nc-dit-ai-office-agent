import { app, InvocationContext, Timer } from "@azure/functions";
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import * as crypto from "crypto";
import { getContainer } from "../shared/cosmos-client";
import { getEmbedding } from "../shared/openai-client";
import { NewsClip } from "../shared/types";

const BING_SEARCH_ENDPOINT = "https://api.bing.microsoft.com/v7.0/news/search";
const KEY_VAULT_URL = process.env.KEY_VAULT_URL ?? "";
const BING_SECRET_NAME = process.env.BING_SECRET_NAME ?? "bing-news-search-key";
const SEARCH_FRESHNESS = process.env.CLIPS_FRESHNESS ?? "Day";
const SEARCH_TERMS = ['"Governor Stein"', '"Gov. Stein"', '"Josh Stein"'];

interface BingNewsArticle {
  name: string;
  url: string;
  description: string;
  provider: Array<{ name: string }>;
  datePublished: string;
}

interface BingNewsResponse {
  value: BingNewsArticle[];
}

async function getBingApiKey(): Promise<string> {
  const credential = new DefaultAzureCredential();
  const client = new SecretClient(KEY_VAULT_URL, credential);
  const secret = await client.getSecret(BING_SECRET_NAME);

  if (!secret.value) {
    throw new Error(`Secret "${BING_SECRET_NAME}" has no value`);
  }

  return secret.value;
}

function computeClipId(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex");
}

function extractMentionContext(text: string): string {
  const mentionPatterns = [/Governor Stein/i, /Gov\. Stein/i, /Josh Stein/i];

  for (const pattern of mentionPatterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      const start = Math.max(0, text.lastIndexOf(".", match.index - 1) + 1);
      const end = text.indexOf(".", match.index + match[0].length);
      return text.slice(start, end === -1 ? undefined : end + 1).trim();
    }
  }

  return text.slice(0, 200);
}

async function fetchBingNews(apiKey: string): Promise<BingNewsArticle[]> {
  const query = SEARCH_TERMS.join(" OR ");
  const params = new URLSearchParams({
    q: query,
    freshness: SEARCH_FRESHNESS,
    count: "50",
    mkt: "en-US",
    sortBy: "Date",
  });

  const response = await fetch(`${BING_SEARCH_ENDPOINT}?${params.toString()}`, {
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Bing News API returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as BingNewsResponse;
  return data.value ?? [];
}

async function processArticle(
  article: BingNewsArticle,
  context: InvocationContext
): Promise<void> {
  const id = computeClipId(article.url);

  const container = getContainer("clips");
  try {
    await container.item(id, id).read();
    context.log(`Clip already exists: ${id} — ${article.name}`);
    return;
  } catch (error: unknown) {
    const statusCode = (error as { code?: number }).code;
    if (statusCode !== 404) {
      throw error;
    }
  }

  const lede = article.description ?? "";
  const mentionContext = extractMentionContext(lede);
  const embeddingText = `${article.name}. ${lede}`;
  const embedding = await getEmbedding(embeddingText);

  const clip: NewsClip = {
    id,
    url: article.url,
    outlet: article.provider?.[0]?.name ?? "Unknown",
    title: article.name,
    publishedAt: article.datePublished,
    lede,
    mentionContext,
    mentionOffset: lede.indexOf(mentionContext),
    fullText: lede,
    ingestedAt: new Date().toISOString(),
    embedding,
  };

  await container.items.create(clip);
  context.log(`Ingested clip: ${clip.outlet} — ${clip.title}`);

  // TODO: Also index into Azure AI Search "clips" index
  // The search index is populated via Cosmos DB change feed or direct indexing.
  // For now, Cosmos DB is the primary store and AI Search indexes will be
  // configured to pull from Cosmos via an indexer.
}

async function clipsIngest(timer: Timer, context: InvocationContext): Promise<void> {
  context.log(`Clips ingestion triggered at ${new Date().toISOString()}`);

  if (timer.isPastDue) {
    context.log("Timer is past due — running anyway");
  }

  if (!KEY_VAULT_URL) {
    context.error("KEY_VAULT_URL environment variable is not set");
    return;
  }

  let apiKey: string;
  try {
    apiKey = await getBingApiKey();
  } catch (error) {
    context.error(`Failed to retrieve Bing API key from Key Vault: ${error}`);
    return;
  }

  let articles: BingNewsArticle[];
  try {
    articles = await fetchBingNews(apiKey);
  } catch (error) {
    context.error(`Failed to fetch Bing News results: ${error}`);
    return;
  }

  context.log(`Found ${articles.length} articles from Bing News`);

  let successCount = 0;
  let errorCount = 0;

  for (const article of articles) {
    try {
      await processArticle(article, context);
      successCount++;
    } catch (error) {
      errorCount++;
      context.error(`Failed to process article "${article.name}": ${error}`);
    }
  }

  context.log(
    `Clips ingestion complete: ${successCount} processed, ${errorCount} errors, ${articles.length} total`
  );
}

app.timer("clips-ingest", {
  schedule: "0 */15 * * * *",
  handler: clipsIngest,
});
