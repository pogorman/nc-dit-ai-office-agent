/**
 * Azure AI Search client factory and hybrid search helper.
 * Authenticates via DefaultAzureCredential — no API keys in code.
 */

import {
  SearchClient,
  SearchOptions,
  AzureKeyCredential,
} from "@azure/search-documents";
import { DefaultAzureCredential } from "@azure/identity";

const searchClients = new Map<string, SearchClient<Record<string, unknown>>>();

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Returns a SearchClient for the given index, creating one if it doesn't exist.
 * Uses DefaultAzureCredential for authentication.
 */
export function getSearchClient<T extends Record<string, unknown>>(
  indexName: string
): SearchClient<T> {
  const existing = searchClients.get(indexName);
  if (existing) {
    return existing as unknown as SearchClient<T>;
  }

  const endpoint = getRequiredEnv("AZURE_AI_SEARCH_ENDPOINT");
  const credential = new DefaultAzureCredential();

  const client = new SearchClient<T>(endpoint, indexName, credential as any);
  searchClients.set(indexName, client as unknown as SearchClient<Record<string, unknown>>);

  return client;
}

export interface HybridSearchOptions {
  /** OData filter expression */
  filter?: string;
  /** Maximum number of results to return (default: 5) */
  top?: number;
}

/**
 * Execute a hybrid search (vector similarity + BM25 keyword) against an AI Search index.
 * Combines the text query for keyword matching with a vector for semantic ranking.
 */
export async function hybridSearch<T extends Record<string, unknown>>(
  indexName: string,
  query: string,
  vector: number[],
  options: HybridSearchOptions = {}
): Promise<T[]> {
  const client = getSearchClient<T>(indexName);
  const top = options.top ?? 5;

  const searchOptions: SearchOptions<T> = {
    top,
    vectorSearchOptions: {
      queries: [
        {
          kind: "vector",
          vector,
          kNearestNeighborsCount: top,
          fields: ["embedding"] as any,
        },
      ],
    },
  };

  if (options.filter) {
    searchOptions.filter = options.filter;
  }

  const results: T[] = [];
  const searchResults = await client.search(query, searchOptions);

  for await (const result of searchResults.results) {
    results.push(result.document);
  }

  return results;
}
