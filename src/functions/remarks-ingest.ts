import { app, InvocationContext } from "@azure/functions";
import { getContainer } from "../shared/cosmos-client";
import { getEmbedding } from "../shared/openai-client";
import { RemarksChunk, RemarksMetadata } from "../shared/types";

const MIN_CHUNK_CHARS = 200;
const MAX_CHUNK_CHARS = 1000;

interface ParsedFilename {
  date: string;
  event: string;
  venue: string;
}

function parseFilename(blobName: string): ParsedFilename {
  // Expected convention: YYYY-MM-DD_event-name_venue.ext
  const baseName = blobName.replace(/\.[^.]+$/, "");
  const parts = baseName.split("_");

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const date = parts[0] && datePattern.test(parts[0]) ? parts[0] : new Date().toISOString().slice(0, 10);
  const event = parts[1]?.replace(/-/g, " ") ?? "Unknown Event";
  const venue = parts[2]?.replace(/-/g, " ") ?? "Unknown Venue";

  return { date, event, venue };
}

function getFileExtension(blobName: string): string {
  const lastDot = blobName.lastIndexOf(".");
  return lastDot === -1 ? "" : blobName.slice(lastDot + 1).toLowerCase();
}

function extractTextFromTxt(buffer: Buffer): string {
  return buffer.toString("utf-8");
}

function extractTextFromDocx(_buffer: Buffer): string {
  // TODO: Implement proper .docx text extraction
  // Options: mammoth, docx4js, or officeparser npm packages
  // For now, attempt a naive extraction of text content from the XML
  // In production, use: import mammoth from "mammoth";
  //   const result = await mammoth.extractRawText({ buffer });
  //   return result.value;
  throw new Error(
    "DOCX extraction not yet implemented. Install 'mammoth' package and uncomment extraction logic."
  );
}

function extractTextFromPdf(_buffer: Buffer): string {
  // TODO: Implement proper PDF text extraction
  // Options: pdf-parse, pdfjs-dist, or Azure Document Intelligence
  // In production, use: import pdf from "pdf-parse";
  //   const data = await pdf(buffer);
  //   return data.text;
  throw new Error(
    "PDF extraction not yet implemented. Install 'pdf-parse' package and uncomment extraction logic."
  );
}

function extractText(buffer: Buffer, extension: string): string {
  switch (extension) {
    case "txt":
      return extractTextFromTxt(buffer);
    case "docx":
      return extractTextFromDocx(buffer);
    case "pdf":
      return extractTextFromPdf(buffer);
    default:
      throw new Error(`Unsupported file type: .${extension}`);
  }
}

function chunkText(text: string): string[] {
  // Split on double newlines (paragraph boundaries)
  const rawParagraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);

  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of rawParagraphs) {
    if (currentChunk.length + paragraph.length + 1 > MAX_CHUNK_CHARS && currentChunk.length >= MIN_CHUNK_CHARS) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    }
  }

  if (currentChunk.trim().length > 0) {
    // If the last chunk is too small and there's a previous chunk, merge it
    if (currentChunk.trim().length < MIN_CHUNK_CHARS && chunks.length > 0) {
      const lastChunk = chunks.pop()!;
      chunks.push(`${lastChunk}\n\n${currentChunk.trim()}`);
    } else {
      chunks.push(currentChunk.trim());
    }
  }

  return chunks;
}

function buildRemarkId(date: string, event: string): string {
  const sanitizedEvent = event.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `remarks-${date}-${sanitizedEvent}`;
}

async function remarksIngest(blob: Buffer, context: InvocationContext): Promise<void> {
  const blobName = context.triggerMetadata?.name as string ?? "unknown";
  context.log(`Remarks ingestion triggered for blob: ${blobName}`);

  if (!blob || blob.length === 0) {
    context.error(`Blob "${blobName}" is empty — skipping`);
    return;
  }

  const extension = getFileExtension(blobName);
  if (!["txt", "docx", "pdf"].includes(extension)) {
    context.error(`Unsupported file type ".${extension}" for blob "${blobName}" — skipping`);
    return;
  }

  let fullText: string;
  try {
    fullText = extractText(blob, extension);
  } catch (error) {
    context.error(`Text extraction failed for "${blobName}": ${error}`);
    return;
  }

  if (fullText.trim().length === 0) {
    context.error(`No text content extracted from "${blobName}" — skipping`);
    return;
  }

  const { date, event, venue } = parseFilename(blobName);
  const remarkId = buildRemarkId(date, event);
  const title = `${event} — ${date}`;

  context.log(`Parsed metadata: date=${date}, event=${event}, venue=${venue}`);

  const chunks = chunkText(fullText);
  context.log(`Split into ${chunks.length} chunks`);

  // Store metadata in Cosmos DB
  try {
    const metadataContainer = getContainer("remarks-metadata");
    const metadata: RemarksMetadata = {
      id: remarkId,
      title,
      date,
      event,
      venue,
      chunkCount: chunks.length,
      sourceFile: blobName,
      ingestedAt: new Date().toISOString(),
    };
    await metadataContainer.items.upsert(metadata);
    context.log(`Stored metadata for ${remarkId}`);
  } catch (error) {
    context.error(`Failed to store metadata for "${blobName}": ${error}`);
    // Continue — indexing chunks is more important
  }

  // Process and index each chunk
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    try {
      const chunkId = `${remarkId}-chunk-${String(i).padStart(3, "0")}`;
      const embedding = await getEmbedding(chunks[i]);

      const remarksChunk: RemarksChunk = {
        id: chunkId,
        remarkId,
        title,
        date,
        event,
        venue,
        chunkIndex: i,
        chunkText: chunks[i],
        topicTags: [], // TODO: Auto-generate topic tags via GPT-4o classification
        embedding,
      };

      // Store chunk in Cosmos DB for indexer to pick up
      const chunksContainer = getContainer("remarks-chunks");
      await chunksContainer.items.upsert(remarksChunk);

      successCount++;
    } catch (error) {
      errorCount++;
      context.error(`Failed to process chunk ${i} of "${blobName}": ${error}`);
    }
  }

  context.log(
    `Remarks ingestion complete for "${blobName}": ${successCount} chunks indexed, ${errorCount} errors`
  );
}

app.storageBlob("remarks-ingest", {
  path: "remarks-uploads/{name}",
  connection: "AzureWebJobsStorage",
  handler: remarksIngest,
});
