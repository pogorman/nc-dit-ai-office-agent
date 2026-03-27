import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from "@azure/functions";
import { Readability } from "@mozilla/readability";
import * as crypto from "crypto";
import { JSDOM } from "jsdom";
import { getContainer } from "../shared/cosmos-client";
import { getEmbedding, webSearch } from "../shared/openai-client";
import { getSearchClient } from "../shared/search-client";
import { NewsClip } from "../shared/types";

const GOV_PRESS_RELEASES_URL = "https://governor.nc.gov/news/press-releases";
const GOV_BASE_URL = "https://governor.nc.gov";
const FETCH_TIMEOUT_MS = 10_000;
const PAGES_TO_SCRAPE = 2; // First 2 pages of press releases (~20 articles)

const WEB_SEARCH_QUERY =
  "Find news articles about North Carolina Governor Josh Stein from the past 6 months. " +
  "Only include articles from news outlets like WRAL, News & Observer, Charlotte Observer, " +
  "AP News, Reuters, NC Policy Watch, Axios, and other media — NOT from governor.nc.gov.";

interface ClipListing {
  title: string;
  url: string;
  date: string;
  summary: string;
  outlet: string;
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
function parseListingPage(html: string): ClipListing[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const rows = doc.querySelectorAll(".views-row");
  const listings: ClipListing[] = [];

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
      outlet: "NC Governor",
    });
  }

  return listings;
}

/**
 * Fetch press release listings from the first N pages of governor.nc.gov.
 */
async function fetchGovListings(
  pages: number,
  context: InvocationContext
): Promise<ClipListing[]> {
  const allListings: ClipListing[] = [];

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
 * Extract outlet name from a URL's hostname.
 * e.g. "https://www.wral.com/story/..." → "WRAL"
 */
function outletFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const domainMap: Record<string, string> = {
      "wral.com": "WRAL",
      "newsobserver.com": "News & Observer",
      "charlotteobserver.com": "Charlotte Observer",
      "apnews.com": "AP News",
      "reuters.com": "Reuters",
      "governor.nc.gov": "NC Governor",
      "ncpolicywatch.com": "NC Policy Watch",
      "wfae.org": "WFAE",
      "wunc.org": "WUNC",
      "specnews1.com": "Spectrum News",
      "axios.com": "Axios",
      "cnn.com": "CNN",
      "foxnews.com": "Fox News",
      "nytimes.com": "New York Times",
      "washingtonpost.com": "Washington Post",
    };
    return domainMap[hostname] ?? hostname;
  } catch {
    return "Unknown";
  }
}

/**
 * Search for news articles using Azure OpenAI Responses API with Bing grounding.
 * Uses the web_search tool to find recent Governor Stein coverage.
 */
async function fetchWebNewsListings(
  context: InvocationContext
): Promise<ClipListing[]> {
  context.log("Searching web for Governor Stein news via Azure OpenAI + Bing grounding");

  try {
    const allResults = await webSearch(WEB_SEARCH_QUERY);
    // Filter out governor.nc.gov — the gov scraper already covers those
    const results = allResults.filter((r) => !r.url.includes("governor.nc.gov"));
    context.log(`Web search returned ${allResults.length} URLs, ${results.length} after excluding gov.nc.gov`);

    return results.map((result) => ({
      title: result.title,
      url: result.url,
      date: "", // Will be extracted from article HTML
      summary: "",
      outlet: outletFromUrl(result.url),
    }));
  } catch (error) {
    context.warn(`Web search failed: ${error}`);
    return [];
  }
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

async function processClip(
  listing: ClipListing,
  context: InvocationContext
): Promise<"new" | "skipped"> {
  const id = computeClipId(listing.url);
  const container = getContainer("clips");

  // Dedup: skip if already ingested
  const { resource: existingClip, statusCode } = await container.item(id, id).read<NewsClip>();
  if (statusCode === 200 && existingClip) {
    context.log(`Clip already exists: ${listing.title}`);
    return "skipped";
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
    outlet: listing.outlet,
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
  return "new";
}

interface IngestionResult {
  successCount: number;
  errorCount: number;
  totalCount: number;
  newCount: number;
  skippedCount: number;
  sources: { gov: number; web: number };
}

async function runIngestion(context: InvocationContext): Promise<IngestionResult> {
  // Fetch from all sources in parallel
  const [govListings, webListings] = await Promise.all([
    fetchGovListings(PAGES_TO_SCRAPE, context).catch((error) => {
      context.error(`Failed to fetch gov listings: ${error}`);
      return [] as ClipListing[];
    }),
    fetchWebNewsListings(context),
  ]);

  // Merge and dedup by URL (first occurrence wins)
  const seen = new Set<string>();
  const listings: ClipListing[] = [];
  for (const listing of [...govListings, ...webListings]) {
    const id = computeClipId(listing.url);
    if (!seen.has(id)) {
      seen.add(id);
      listings.push(listing);
    }
  }

  context.log(
    `Sources: ${govListings.length} gov + ${webListings.length} web → ${listings.length} unique clips`
  );

  let successCount = 0;
  let errorCount = 0;
  let newCount = 0;
  let skippedCount = 0;

  for (const listing of listings) {
    try {
      const result = await processClip(listing, context);
      successCount++;
      if (result === "new") newCount++;
      else skippedCount++;
    } catch (error) {
      errorCount++;
      context.error(`Failed to process "${listing.title}": ${error}`);
    }
  }

  context.log(
    `Clips ingestion complete: ${newCount} new, ${skippedCount} skipped, ${errorCount} errors, ${listings.length} total`
  );

  return {
    successCount,
    errorCount,
    totalCount: listings.length,
    newCount,
    skippedCount,
    sources: { gov: govListings.length, web: webListings.length },
  };
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
