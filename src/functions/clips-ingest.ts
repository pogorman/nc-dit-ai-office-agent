import { app, InvocationContext, Timer } from "@azure/functions";
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import { Readability } from "@mozilla/readability";
import * as crypto from "crypto";
import { JSDOM } from "jsdom";
import { getContainer } from "../shared/cosmos-client";
import { getEmbedding } from "../shared/openai-client";
import { NewsClip } from "../shared/types";

const BING_SEARCH_ENDPOINT = "https://api.bing.microsoft.com/v7.0/news/search";
const KEY_VAULT_URL = process.env.KEY_VAULT_URL ?? "";
const BING_SECRET_NAME = process.env.BING_SECRET_NAME ?? "bing-news-search-key";
const SEARCH_FRESHNESS = process.env.CLIPS_FRESHNESS ?? "Day";
const SEARCH_TERMS = ['"Governor Stein"', '"Gov. Stein"', '"Josh Stein"'];
const FETCH_TIMEOUT_MS = 10_000;

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

interface ExtractedArticle {
  fullText: string;
  lede: string;
  mentionContext: string;
  mentionOffset: number;
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

/**
 * Fetch the raw HTML of an article URL with a timeout.
 * Returns null if the fetch fails (paywalled, blocked, timeout, etc.).
 */
async function fetchArticleHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NCCommsAgent/1.0; +https://nc.gov)",
        Accept: "text/html",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Use Mozilla Readability to extract clean article text from raw HTML.
 * Returns null if extraction fails or produces no content.
 */
function parseArticleContent(html: string, url: string): string | null {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article?.textContent) {
    return null;
  }

  // Readability textContent can have excessive whitespace — normalize it
  return article.textContent.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Extract the first paragraph (lede) from article text.
 * Splits on double newlines and returns the first non-trivial paragraph.
 */
function extractLede(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 40);
  return paragraphs[0] ?? text.slice(0, 500);
}

/**
 * Find the first mention of Governor Stein in the text and return
 * the surrounding sentence(s) as context, plus the character offset.
 */
function extractMentionContext(text: string): { context: string; offset: number } {
  const mentionPatterns = [/Governor Stein/i, /Gov\. Stein/i, /Josh Stein/i];

  for (const pattern of mentionPatterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      // Walk back to the previous sentence boundary (period + space, or start of text)
      const lookBack = text.slice(Math.max(0, match.index - 300), match.index);
      const sentenceStart = Math.max(
        lookBack.lastIndexOf(". "),
        lookBack.lastIndexOf(".\n"),
        0
      );
      const start = Math.max(0, match.index - 300) + sentenceStart + (sentenceStart > 0 ? 2 : 0);

      // Walk forward to the next sentence boundary
      const lookAhead = text.slice(match.index + match[0].length);
      const nextPeriod = lookAhead.search(/\.\s/);
      const end = nextPeriod === -1
        ? Math.min(text.length, match.index + match[0].length + 300)
        : match.index + match[0].length + nextPeriod + 1;

      return {
        context: text.slice(start, end).trim(),
        offset: match.index,
      };
    }
  }

  return { context: text.slice(0, 300), offset: 0 };
}

/**
 * Fetch and extract the full article content from a URL.
 * Falls back to Bing's description snippet if the fetch or parse fails.
 */
async function extractArticleContent(
  url: string,
  bingDescription: string,
  context: InvocationContext
): Promise<ExtractedArticle> {
  const html = await fetchArticleHtml(url);

  if (!html) {
    context.log(`Could not fetch article HTML — using Bing snippet: ${url}`);
    const mention = extractMentionContext(bingDescription);
    return {
      fullText: bingDescription,
      lede: bingDescription,
      mentionContext: mention.context,
      mentionOffset: mention.offset,
    };
  }

  const articleText = parseArticleContent(html, url);

  if (!articleText || articleText.length < 50) {
    context.log(`Readability extraction too short — using Bing snippet: ${url}`);
    const mention = extractMentionContext(bingDescription);
    return {
      fullText: bingDescription,
      lede: bingDescription,
      mentionContext: mention.context,
      mentionOffset: mention.offset,
    };
  }

  const lede = extractLede(articleText);
  const mention = extractMentionContext(articleText);

  context.log(`Extracted ${articleText.length} chars from ${url}`);

  return {
    fullText: articleText,
    lede,
    mentionContext: mention.context,
    mentionOffset: mention.offset,
  };
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

  // Fetch and parse the actual article content
  const extracted = await extractArticleContent(article.url, article.description ?? "", context);

  const embeddingText = `${article.name}. ${extracted.lede}`;
  const embedding = await getEmbedding(embeddingText);

  const clip: NewsClip = {
    id,
    url: article.url,
    outlet: article.provider?.[0]?.name ?? "Unknown",
    title: article.name,
    publishedAt: article.datePublished,
    lede: extracted.lede,
    mentionContext: extracted.mentionContext,
    mentionOffset: extracted.mentionOffset,
    fullText: extracted.fullText,
    ingestedAt: new Date().toISOString(),
    embedding,
  };

  await container.items.create(clip);
  context.log(`Ingested clip: ${clip.outlet} — ${clip.title}`);
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
