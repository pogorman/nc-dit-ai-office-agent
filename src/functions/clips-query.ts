import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getEmbedding } from "../shared/openai-client";
import { getSearchClient, hybridSearch } from "../shared/search-client";
import { NewsClip } from "../shared/types";

interface ClipsQueryRequest {
  query: string;
  dateFrom?: string;
  dateTo?: string;
  top?: number;
}

const MAX_TOP = 50;
const DEFAULT_TOP = 10;

function isLatestMode(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return normalized === "" || normalized === "latest" || normalized === "today";
}

function buildDateFilter(dateFrom?: string, dateTo?: string): string | undefined {
  const filters: string[] = [];

  if (dateFrom) {
    filters.push(`publishedAt ge ${dateFrom}`);
  }
  if (dateTo) {
    filters.push(`publishedAt le ${dateTo}`);
  }

  return filters.length > 0 ? filters.join(" and ") : undefined;
}

async function fetchLatestClips(top: number, dateFrom?: string, dateTo?: string): Promise<NewsClip[]> {
  const client = getSearchClient<NewsClip>("clips");
  const filter = buildDateFilter(dateFrom, dateTo);

  const results: NewsClip[] = [];
  const searchResults = await client.search("*", {
    top,
    orderBy: ["publishedAt desc"],
    filter,
  });

  for await (const result of searchResults.results) {
    results.push(result.document);
  }

  return results;
}

async function clipsQuery(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log(`Clips query received at ${new Date().toISOString()}`);

  let body: ClipsQueryRequest;
  try {
    body = (await request.json()) as ClipsQueryRequest;
  } catch {
    return {
      status: 400,
      jsonBody: { error: "Invalid JSON in request body" },
    };
  }

  const { query, dateFrom, dateTo } = body;
  const top = Math.min(body.top ?? DEFAULT_TOP, MAX_TOP);

  if (query === undefined || query === null) {
    return {
      status: 400,
      jsonBody: { error: "Missing required field: query" },
    };
  }

  try {
    if (isLatestMode(query)) {
      context.log("Fetching latest clips from Cosmos DB");
      const clips = await fetchLatestClips(top, dateFrom, dateTo);
      return { status: 200, jsonBody: { clips, count: clips.length } };
    }

    context.log(`Searching clips for: "${query}"`);

    const embedding = await getEmbedding(query);
    const filter = buildDateFilter(dateFrom, dateTo);

    const results = await hybridSearch<NewsClip>("clips", query, embedding, {
      filter,
      top,
    });

    return {
      status: 200,
      jsonBody: { clips: results, count: results.length },
    };
  } catch (error) {
    context.error(`Clips query failed: ${error}`);
    return {
      status: 500,
      jsonBody: { error: "Internal server error during clips search" },
    };
  }
}

app.http("clips-query", {
  methods: ["POST"],
  route: "clips/query",
  authLevel: "function",
  handler: clipsQuery,
});
