/**
 * Transcript Proofread Function — Phase 1.
 *
 * HTTP POST /api/proofread
 * Accepts a raw transcript, sends it through GPT-4o for cleanup,
 * and returns a corrected version with a detailed change log.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getChatCompletion } from "../shared/openai-client.js";
import type { ProofreadRequest, ProofreadResponse, ProofreadChange } from "../shared/types.js";

const MAX_TRANSCRIPT_LENGTH = 100_000;

const SYSTEM_PROMPT_BASE = `You are a professional transcript proofreader for the North Carolina Governor's Communications Office.

Your job is to clean up faulty transcripts that may contain ASR (automatic speech recognition) or OCR (optical character recognition) artifacts.

Rules:
1. Fix obvious ASR/OCR errors: homophones, garbled words, missing punctuation, run-on sentences.
2. Preserve the original meaning exactly — do NOT rephrase, summarize, or editorialize.
3. When you are uncertain about a correction, mark it with [?] in the corrected text.
4. Fix capitalization for proper nouns (Governor Stein, North Carolina, General Assembly, etc.).
5. Fix number formatting (spell out numbers under 10, use digits for 10+, consistent date/time formats).
6. Do NOT change dialect, tone, or speaking style — this is a transcript, not an essay.

Return your response as valid JSON with this exact schema:
{
  "corrected": "The fully corrected transcript text",
  "changes": [
    {
      "original": "the exact original text that was changed",
      "corrected": "what it was changed to",
      "confidence": "high" | "medium" | "low",
      "reason": "brief explanation"
    }
  ],
  "summary": "A 1-2 sentence summary of the types of corrections made"
}

Return ONLY the JSON object. No markdown fences, no commentary.`;

const SPEAKER_LABEL_ADDENDUM = `
7. Normalize speaker labels to a consistent format: "Speaker Name:" at the start of each turn.
   - Fix inconsistent labels (e.g., "Gov.", "Governor", "Gov Stein" → "Governor Stein:")
   - Ensure each speaker turn starts on a new line with the label followed by a colon and a space.`;

function buildSystemPrompt(speakerLabels: boolean): string {
  if (!speakerLabels) {
    return SYSTEM_PROMPT_BASE;
  }
  return SYSTEM_PROMPT_BASE + SPEAKER_LABEL_ADDENDUM;
}

function validateRequest(body: unknown): { isValid: true; data: ProofreadRequest } | { isValid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { isValid: false, error: "Request body must be a JSON object" };
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.transcript !== "string") {
    return { isValid: false, error: "\"transcript\" field is required and must be a string" };
  }

  const transcript = obj.transcript.trim();

  if (transcript.length === 0) {
    return { isValid: false, error: "\"transcript\" field must not be empty" };
  }

  if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
    return {
      isValid: false,
      error: `Transcript exceeds maximum length of ${MAX_TRANSCRIPT_LENGTH} characters (received ${transcript.length})`,
    };
  }

  const speakerLabels = typeof obj.speakerLabels === "boolean" ? obj.speakerLabels : false;

  return {
    isValid: true,
    data: { transcript, speakerLabels },
  };
}

function parseProofreadResponse(raw: string): ProofreadResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GPT-4o returned invalid JSON — retry may help");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.corrected !== "string") {
    throw new Error("GPT-4o response missing \"corrected\" field");
  }

  if (!Array.isArray(obj.changes)) {
    throw new Error("GPT-4o response missing \"changes\" array");
  }

  const changes: ProofreadChange[] = (obj.changes as unknown[]).map((c) => {
    const change = c as Record<string, unknown>;
    return {
      original: String(change.original ?? ""),
      corrected: String(change.corrected ?? ""),
      confidence: (["high", "medium", "low"].includes(String(change.confidence))
        ? String(change.confidence)
        : "medium") as "high" | "medium" | "low",
      reason: String(change.reason ?? ""),
    };
  });

  return {
    corrected: obj.corrected,
    changes,
    summary: typeof obj.summary === "string" ? obj.summary : "Transcript proofread completed.",
  };
}

async function proofread(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log("Proofread function invoked");

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      status: 400,
      jsonBody: { error: "Invalid JSON in request body" },
    };
  }

  // Validate
  const validation = validateRequest(body);
  if (!validation.isValid) {
    return {
      status: 400,
      jsonBody: { error: validation.error },
    };
  }

  const { transcript, speakerLabels } = validation.data;
  const systemPrompt = buildSystemPrompt(speakerLabels ?? false);

  context.log(`Processing transcript: ${transcript.length} chars, speakerLabels=${speakerLabels}`);

  // Call GPT-4o
  let rawResponse: string;
  try {
    rawResponse = await getChatCompletion(systemPrompt, transcript, {
      temperature: 0.2,
      maxTokens: 8192,
    });
  } catch (err) {
    context.error("Azure OpenAI call failed:", err);
    return {
      status: 502,
      jsonBody: { error: "Failed to process transcript — Azure OpenAI unavailable" },
    };
  }

  // Parse structured response
  let result: ProofreadResponse;
  try {
    result = parseProofreadResponse(rawResponse);
  } catch (err) {
    context.error("Failed to parse GPT-4o response:", err);
    return {
      status: 502,
      jsonBody: { error: "Failed to parse AI response — retry may help" },
    };
  }

  context.log(`Proofread complete: ${result.changes.length} changes`);

  return {
    status: 200,
    jsonBody: result,
  };
}

app.http("proofread", {
  methods: ["POST"],
  authLevel: "function",
  route: "proofread",
  handler: proofread,
});
