/**
 * Singleton Azure OpenAI client with helpers for chat completions and embeddings.
 * Authenticates via DefaultAzureCredential — no API keys in code.
 *
 * Uses the `openai` package's AzureOpenAI class with `@azure/identity`
 * for Entra ID token-based authentication (the @azure/openai v2 pattern).
 */

import { AzureOpenAI, OpenAI, toFile } from "openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

let clientInstance: AzureOpenAI | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getClient(): AzureOpenAI {
  if (clientInstance) {
    return clientInstance;
  }

  const endpoint = getRequiredEnv("AZURE_OPENAI_ENDPOINT");
  const credential = new DefaultAzureCredential();
  const scope = "https://cognitiveservices.azure.com/.default";
  const azureADTokenProvider = getBearerTokenProvider(credential, scope);

  clientInstance = new AzureOpenAI({
    endpoint,
    azureADTokenProvider,
    apiVersion: "2024-10-21",
  });

  return clientInstance;
}

export interface WebSearchResult {
  title: string;
  url: string;
}

/**
 * Search the web using Azure OpenAI's Responses API with Bing grounding.
 * Returns URLs and titles from the search results.
 */
export async function webSearch(query: string): Promise<WebSearchResult[]> {
  const endpoint = getRequiredEnv("AZURE_OPENAI_ENDPOINT");
  const credential = new DefaultAzureCredential();
  const scope = "https://cognitiveservices.azure.com/.default";
  const tokenProvider = getBearerTokenProvider(credential, scope);
  const deploymentName = getRequiredEnv("GPT4O_DEPLOYMENT_NAME");
  const token = await tokenProvider();

  // Use base OpenAI class with Azure Responses API endpoint
  const client = new OpenAI({
    baseURL: `${endpoint.replace(/\/$/, "")}/openai/v1/`,
    apiKey: token,
  });

  const response = await client.responses.create({
    model: deploymentName,
    tools: [{ type: "web_search" as const, search_context_size: "high" as const }],
    input: query,
  });

  // Extract URL citations from the response
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();

  for (const item of response.output) {
    if (item.type === "message") {
      for (const content of item.content) {
        if (content.type === "output_text" && content.annotations) {
          for (const annotation of content.annotations) {
            if (annotation.type === "url_citation" && !seen.has(annotation.url)) {
              seen.add(annotation.url);
              results.push({
                title: annotation.title,
                url: annotation.url,
              });
            }
          }
        }
      }
    }
  }

  return results;
}

/**
 * Transcribe an audio/video file using Azure OpenAI Whisper.
 * Accepts a Buffer and filename; returns the transcript text.
 * Max file size: 25MB (Whisper API limit).
 */
export async function transcribeAudio(
  buffer: Buffer,
  filename: string,
  language?: string
): Promise<string> {
  const client = getClient();
  const deploymentName = getRequiredEnv("WHISPER_DEPLOYMENT_NAME");

  const file = await toFile(buffer, filename);

  const transcription = await client.audio.transcriptions.create({
    model: deploymentName,
    file,
    ...(language ? { language } : {}),
  });

  return transcription.text;
}

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * Get a chat completion from GPT-4o.
 * Uses the deployment name from the GPT4O_DEPLOYMENT_NAME env var.
 */
export async function getChatCompletion(
  systemPrompt: string,
  userPrompt: string,
  options: ChatCompletionOptions = {}
): Promise<string> {
  const client = getClient();
  const deploymentName = getRequiredEnv("GPT4O_DEPLOYMENT_NAME");

  const isReasoningModel = deploymentName.startsWith("gpt-5") || deploymentName.startsWith("o");

  const response = await client.chat.completions.create({
    model: deploymentName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    ...(isReasoningModel ? {} : { temperature: options.temperature ?? 0.3 }),
    max_completion_tokens: options.maxTokens ?? (isReasoningModel ? 16384 : 4096),
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Azure OpenAI returned an empty response");
  }

  return content;
}

/**
 * Generate an embedding vector for the given text.
 * Uses the deployment name from the EMBEDDING_DEPLOYMENT_NAME env var.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const client = getClient();
  const deploymentName = getRequiredEnv("EMBEDDING_DEPLOYMENT_NAME");

  const response = await client.embeddings.create({
    model: deploymentName,
    input: text,
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new Error("Azure OpenAI returned an empty embedding");
  }

  return embedding;
}
