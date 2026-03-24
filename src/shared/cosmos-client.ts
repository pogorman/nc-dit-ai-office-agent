/**
 * Singleton Cosmos DB client with container accessor.
 * Authenticates via DefaultAzureCredential — no connection strings in code.
 */

import { CosmosClient, Container, Database } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

const DATABASE_NAME = process.env.COSMOS_DB_DATABASE ?? "comms-agent";

let cosmosClientInstance: CosmosClient | null = null;
let databaseInstance: Database | null = null;
const containerCache = new Map<string, Container>();

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getCosmosClient(): CosmosClient {
  if (cosmosClientInstance) {
    return cosmosClientInstance;
  }

  const endpoint = getRequiredEnv("COSMOS_DB_ENDPOINT");
  const credential = new DefaultAzureCredential();

  cosmosClientInstance = new CosmosClient({
    endpoint,
    aadCredentials: credential,
  });

  return cosmosClientInstance;
}

function getDatabase(): Database {
  if (databaseInstance) {
    return databaseInstance;
  }

  const client = getCosmosClient();
  databaseInstance = client.database(DATABASE_NAME);

  return databaseInstance;
}

/**
 * Returns a Cosmos DB Container reference for the given container name.
 * Caches container references to avoid repeated lookups.
 */
export function getContainer(containerName: string): Container {
  const cached = containerCache.get(containerName);
  if (cached) {
    return cached;
  }

  const database = getDatabase();
  const container = database.container(containerName);
  containerCache.set(containerName, container);

  return container;
}
