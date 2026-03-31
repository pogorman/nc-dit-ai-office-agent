/**
 * Dump all clips from Cosmos DB as a simple table: date | outlet | title
 * Usage: npx tsx seed/dump-clips.ts
 * Requires: COSMOS_DB_ENDPOINT env var + DefaultAzureCredential access
 */

import { CosmosClient } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

const endpoint = process.env.COSMOS_DB_ENDPOINT;
if (!endpoint) {
  console.error("Set COSMOS_DB_ENDPOINT environment variable");
  process.exit(1);
}

const client = new CosmosClient({
  endpoint,
  aadCredentials: new DefaultAzureCredential(),
});

const container = client.database("comms-agent").container("clips");

async function main() {
  const { resources: clips } = await container.items
    .query<{ title: string; publishedAt: string; outlet: string }>({
      query: "SELECT c.title, c.publishedAt, c.outlet FROM c ORDER BY c.publishedAt DESC",
    })
    .fetchAll();

  console.log(`\n${clips.length} clips total\n`);
  console.log("Date       | Outlet                       | Title");
  console.log("---------- | ---------------------------- | -----");

  for (const c of clips) {
    const date = c.publishedAt.slice(0, 10);
    const outlet = c.outlet.padEnd(28);
    console.log(`${date} | ${outlet} | ${c.title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
