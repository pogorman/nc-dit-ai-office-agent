import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from "@azure/functions";
import { Readability } from "@mozilla/readability";
import * as crypto from "crypto";
import { JSDOM } from "jsdom";
import { getContainer } from "../shared/cosmos-client";
import { getEmbedding } from "../shared/openai-client";
import { getSearchClient } from "../shared/search-client";
import { NewsClip } from "../shared/types";

const GOV_PRESS_RELEASES_URL = "https://governor.nc.gov/news/press-releases";
const GOV_BASE_URL = "https://governor.nc.gov";
const FETCH_TIMEOUT_MS = 10_000;
const PAGES_TO_SCRAPE = 2; // First 2 pages of press releases (~20 articles)

interface PressReleaseListing {
  title: string;
  url: string;
  date: string;
  summary: string;
}

function computeClipId(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex");
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NCCommsAgent/1.0; +https://nc.gov)",
        Accept: "text/html",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Scrape the governor.nc.gov press releases listing page.
 * Extracts title, URL, date, and summary for each press release.
 */
function parseListingPage(html: string): PressReleaseListing[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const rows = doc.querySelectorAll(".views-row");
  const listings: PressReleaseListing[] = [];

  for (const row of rows) {
    const linkEl = row.querySelector(".views-field-title h2 a");
    const dateEl = row.querySelector(".views-field-field-release-date time");
    const dateContentEl = row.querySelector(".views-field-field-release-date span[content]");
    const summaryEl = row.querySelector(".views-field-body .field-content");

    if (!linkEl) continue;

    const href = linkEl.getAttribute("href") ?? "";
    const fullUrl = href.startsWith("http") ? href : `${GOV_BASE_URL}${href}`;

    listings.push({
      title: linkEl.textContent?.trim() ?? "",
      url: fullUrl,
      date: dateContentEl?.getAttribute("content") ?? dateEl?.textContent?.trim() ?? "",
      summary: summaryEl?.textContent?.trim() ?? "",
    });
  }

  return listings;
}

/**
 * Fetch press release listings from the first N pages.
 */
async function fetchPressReleaseListings(
  pages: number,
  context: InvocationContext
): Promise<PressReleaseListing[]> {
  const allListings: PressReleaseListing[] = [];

  for (let page = 0; page < pages; page++) {
    const url = page === 0 ? GOV_PRESS_RELEASES_URL : `${GOV_PRESS_RELEASES_URL}?page=${page}`;
    context.log(`Fetching listing page ${page + 1}: ${url}`);

    const html = await fetchHtml(url);
    if (!html) {
      context.warn(`Failed to fetch listing page ${page + 1}`);
      break;
    }

    const listings = parseListingPage(html);
    context.log(`Found ${listings.length} press releases on page ${page + 1}`);
    allListings.push(...listings);
  }

  return allListings;
}

/**
 * Use Readability to extract clean article text from raw HTML.
 */
function parseArticleContent(html: string, url: string): string | null {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article?.textContent) return null;
  return article.textContent.replace(/\n{3,}/g, "\n\n").trim();
}

function extractLede(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 40);
  return paragraphs[0] ?? text.slice(0, 500);
}

function extractMentionContext(text: string): { context: string; offset: number } {
  const mentionPatterns = [/Governor Stein/i, /Gov\. Stein/i, /Josh Stein/i];

  for (const pattern of mentionPatterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      const lookBack = text.slice(Math.max(0, match.index - 300), match.index);
      const sentenceStart = Math.max(
        lookBack.lastIndexOf(". "),
        lookBack.lastIndexOf(".\n"),
        0
      );
      const start = Math.max(0, match.index - 300) + sentenceStart + (sentenceStart > 0 ? 2 : 0);

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

async function processRelease(
  listing: PressReleaseListing,
  context: InvocationContext
): Promise<void> {
  const id = computeClipId(listing.url);
  const container = getContainer("clips");

  // Dedup: skip if already ingested
  try {
    await container.item(id, id).read();
    context.log(`Clip already exists: ${listing.title}`);
    return;
  } catch (error: unknown) {
    const code = (error as { code?: number | string }).code;
    if (code !== 404 && code !== "NotFound") throw error;
  }

  // Fetch and parse the full article
  const html = await fetchHtml(listing.url);
  let fullText = listing.summary;
  let lede = listing.summary;
  let mentionContext = listing.summary.slice(0, 300);
  let mentionOffset = 0;

  if (html) {
    const articleText = parseArticleContent(html, listing.url);
    if (articleText && articleText.length > 50) {
      fullText = articleText;
      lede = extractLede(articleText);
      const mention = extractMentionContext(articleText);
      mentionContext = mention.context;
      mentionOffset = mention.offset;
      context.log(`Extracted ${articleText.length} chars from ${listing.url}`);
    }
  }

  // Generate embedding
  const embeddingText = `${listing.title}. ${lede}`;
  const embedding = await getEmbedding(embeddingText);

  const clip: NewsClip = {
    id,
    url: listing.url,
    outlet: "NC Governor",
    title: listing.title,
    publishedAt: listing.date ? new Date(listing.date).toISOString() : new Date().toISOString(),
    lede,
    mentionContext,
    mentionOffset,
    fullText,
    ingestedAt: new Date().toISOString(),
    embedding,
  };

  // Store in Cosmos DB
  await container.items.create(clip);

  // Index into AI Search
  try {
    const searchClient = getSearchClient<NewsClip>("clips");
    await searchClient.mergeOrUploadDocuments([clip]);
  } catch (error) {
    context.warn(`AI Search indexing failed for "${listing.title}": ${error}`);
  }

  context.log(`Ingested clip: ${clip.title}`);
}

async function runIngestion(context: InvocationContext): Promise<{ successCount: number; errorCount: number; totalCount: number }> {
  let listings: PressReleaseListing[];
  try {
    listings = await fetchPressReleaseListings(PAGES_TO_SCRAPE, context);
  } catch (error) {
    context.error(`Failed to fetch press release listings: ${error}`);
    return { successCount: 0, errorCount: 0, totalCount: 0 };
  }

  context.log(`Found ${listings.length} press releases to process`);

  let successCount = 0;
  let errorCount = 0;

  for (const listing of listings) {
    try {
      await processRelease(listing, context);
      successCount++;
    } catch (error) {
      errorCount++;
      context.error(`Failed to process "${listing.title}": ${error}`);
    }
  }

  context.log(
    `Clips ingestion complete: ${successCount} processed, ${errorCount} errors, ${listings.length} total`
  );

  return { successCount, errorCount, totalCount: listings.length };
}

async function clipsIngest(timer: Timer, context: InvocationContext): Promise<void> {
  context.log(`Clips ingestion triggered at ${new Date().toISOString()}`);

  if (timer.isPastDue) {
    context.log("Timer is past due — running anyway");
  }

  await runIngestion(context);
}

async function clipsRefresh(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log(`Manual clips refresh triggered at ${new Date().toISOString()}`);
  const result = await runIngestion(context);
  return { jsonBody: result };
}

app.timer("clips-ingest", {
  schedule: "0 0 7 * * *",
  handler: clipsIngest,
});

app.http("clips-refresh", {
  methods: ["POST"],
  authLevel: "function",
  route: "clips/refresh",
  handler: clipsRefresh,
});
