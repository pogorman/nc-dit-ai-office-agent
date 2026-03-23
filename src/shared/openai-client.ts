/**
 * Singleton Azure OpenAI client with helpers for chat completions and embeddings.
 * Authenticates via DefaultAzureCredential — no API keys in code.
 *
 * Uses the `openai` package's AzureOpenAI class with `@azure/identity`
 * for Entra ID token-based authentication (the @azure/openai v2 pattern).
 */

import { AzureOpenAI } from "openai";
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

  const response = await client.chat.completions.create({
    model: deploymentName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 4096,
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
