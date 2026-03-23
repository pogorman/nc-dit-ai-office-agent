import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getEmbedding, getChatCompletion } from "../shared/openai-client";
import { hybridSearch } from "../shared/search-client";
import { RemarksChunk } from "../shared/types";

interface RemarksQueryRequest {
  query: string;
  event?: string;
  dateFrom?: string;
  dateTo?: string;
  top?: number;
  synthesize?: boolean;
}

interface RemarksQueryResponse {
  synthesis?: string;
  sources: RemarksChunk[];
  count: number;
}

const MAX_TOP = 30;
const DEFAULT_TOP = 10;

const SYNTHESIS_SYSTEM_PROMPT = `You are a communications research assistant for the Governor's office. Given the following excerpts from the Governor's remarks, synthesize the language used on the requested topic. Include direct quotes with citations (date, event). Note any evolution in messaging over time. Be precise and factual — only reference language that appears in the provided excerpts.`;

function buildFilter(event?: string, dateFrom?: string, dateTo?: string): string | undefined {
  const filters: string[] = [];

  if (event) {
    filters.push(`event eq '${event.replace(/'/g, "''")}'`);
  }
  if (dateFrom) {
    filters.push(`date ge '${dateFrom}'`);
  }
  if (dateTo) {
    filters.push(`date le '${dateTo}'`);
  }

  return filters.length > 0 ? filters.join(" and ") : undefined;
}

function formatChunksForSynthesis(query: string, chunks: RemarksChunk[]): string {
  const formattedChunks = chunks
    .map(
      (chunk, i) =>
        `[${i + 1}] Date: ${chunk.date} | Event: ${chunk.event} | Venue: ${chunk.venue}\n"${chunk.chunkText}"`
    )
    .join("\n\n");

  return `Topic/Question: ${query}\n\nRemarks excerpts:\n\n${formattedChunks}`;
}

async function remarksQuery(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log(`Remarks query received at ${new Date().toISOString()}`);

  let body: RemarksQueryRequest;
  try {
    body = (await request.json()) as RemarksQueryRequest;
  } catch {
    return {
      status: 400,
      jsonBody: { error: "Invalid JSON in request body" },
    };
  }

  const { query, event, dateFrom, dateTo } = body;
  const top = Math.min(body.top ?? DEFAULT_TOP, MAX_TOP);
  const shouldSynthesize = body.synthesize !== false; // default true

  if (!query || query.trim().length === 0) {
    return {
      status: 400,
      jsonBody: { error: "Missing required field: query" },
    };
  }

  try {
    context.log(`Searching remarks for: "${query}" (synthesize=${shouldSynthesize})`);

    const embedding = await getEmbedding(query);
    const filter = buildFilter(event, dateFrom, dateTo);

    const chunks = await hybridSearch<RemarksChunk>("remarks", query, embedding, {
      filter,
      top,
    });

    if (chunks.length === 0) {
      const response: RemarksQueryResponse = {
        synthesis: shouldSynthesize
          ? "No matching remarks found for this query."
          : undefined,
        sources: [],
        count: 0,
      };
      return { status: 200, jsonBody: response };
    }

    if (!shouldSynthesize) {
      const response: RemarksQueryResponse = {
        sources: chunks,
        count: chunks.length,
      };
      return { status: 200, jsonBody: response };
    }

    const userPrompt = formatChunksForSynthesis(query, chunks);
    const synthesis = await getChatCompletion(SYNTHESIS_SYSTEM_PROMPT, userPrompt, {
      temperature: 0.3,
      maxTokens: 1500,
    });

    const response: RemarksQueryResponse = {
      synthesis,
      sources: chunks,
      count: chunks.length,
    };

    return { status: 200, jsonBody: response };
  } catch (error) {
    context.error(`Remarks query failed: ${error}`);
    return {
      status: 500,
      jsonBody: { error: "Internal server error during remarks search" },
    };
  }
}

app.http("remarks-query", {
  methods: ["POST"],
  route: "remarks/query",
  authLevel: "function",
  handler: remarksQuery,
});
