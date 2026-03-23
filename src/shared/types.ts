/**
 * Data models for NC DIT AI Office Agent.
 * Aligned with the schemas defined in ARCHITECTURE.md.
 */

// ---------------------------------------------------------------------------
// News Clips
// ---------------------------------------------------------------------------

export interface NewsClip {
  /** SHA-256 hash of the article URL */
  id: string;
  /** Source article URL */
  url: string;
  /** News outlet name (e.g. "WRAL", "Charlotte Observer") */
  outlet: string;
  /** Article headline */
  title: string;
  /** ISO 8601 publication timestamp */
  publishedAt: string;
  /** First paragraph / lede of the article */
  lede: string;
  /** Sentence or paragraph containing the first mention of the Governor */
  mentionContext: string;
  /** Character offset of the first mention within fullText */
  mentionOffset: number;
  /** Full article text when available */
  fullText: string;
  /** ISO 8601 timestamp when the clip was ingested */
  ingestedAt: string;
  /** Vector embedding for semantic search */
  embedding?: number[];
  /** Allow additional index fields */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Remarks
// ---------------------------------------------------------------------------

export interface RemarksChunk {
  /** Composite key: remarkId + chunk index */
  id: string;
  /** Parent remark identifier */
  remarkId: string;
  /** Speech / remarks title */
  title: string;
  /** Date of the remarks (YYYY-MM-DD) */
  date: string;
  /** Event name (e.g. "State of the State") */
  event: string;
  /** Venue where the remarks were delivered */
  venue: string;
  /** Zero-based index of this chunk within the full document */
  chunkIndex: number;
  /** The actual text content of this chunk */
  chunkText: string;
  /** Topic tags inferred during ingestion */
  topicTags: string[];
  /** Vector embedding for semantic search */
  embedding?: number[];
  /** Allow additional index fields */
  [key: string]: unknown;
}

export interface RemarksMetadata {
  /** Cosmos DB document id */
  id: string;
  /** Unique remark identifier (alias for id) */
  remarkId?: string;
  /** Speech / remarks title */
  title: string;
  /** Date of the remarks (YYYY-MM-DD) */
  date: string;
  /** Event name */
  event: string;
  /** Venue */
  venue: string;
  /** Original uploaded file name */
  fileName?: string;
  /** Source blob name */
  sourceFile?: string;
  /** Number of chunks generated */
  chunkCount?: number;
  /** ISO 8601 timestamp when the document was uploaded */
  uploadedAt?: string;
  /** ISO 8601 timestamp when the document was ingested */
  ingestedAt?: string;
}

// ---------------------------------------------------------------------------
// Transcript Proofreading
// ---------------------------------------------------------------------------

export interface ProofreadRequest {
  /** Raw transcript text to proofread */
  transcript: string;
  /** Whether to normalize speaker labels (e.g. "Speaker 1:" → consistent format) */
  speakerLabels?: boolean;
}

export interface ProofreadChange {
  /** Original text that was changed */
  original: string;
  /** Corrected text */
  corrected: string;
  /** How confident the model is in this correction */
  confidence: "high" | "medium" | "low";
  /** Brief explanation of why the change was made */
  reason: string;
}

export interface ProofreadResponse {
  /** The fully corrected transcript */
  corrected: string;
  /** Individual changes made, with confidence and reasoning */
  changes: ProofreadChange[];
  /** Human-readable summary of all corrections */
  summary: string;
}
