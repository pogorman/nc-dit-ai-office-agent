/**
 * Video/Audio Transcription Function.
 *
 * HTTP POST /api/transcribe
 * Accepts a multipart/form-data upload with an audio or video file,
 * sends it to Azure OpenAI Whisper for transcription, and returns the text.
 *
 * Supported formats: mp3, mp4, mpeg, mpga, m4a, wav, webm
 * Max file size: 25MB (Whisper API limit)
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { transcribeAudio } from "../shared/openai-client.js";
import type { TranscribeResponse } from "../shared/types.js";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_EXTENSIONS = new Set(["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"]);

function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

async function transcribe(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log("Transcribe function invoked");

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return {
      status: 400,
      jsonBody: { error: "Request must be multipart/form-data with a 'file' field" },
    };
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return {
      status: 400,
      jsonBody: { error: "Missing 'file' field — upload an audio or video file" },
    };
  }

  // Validate file extension
  const ext = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      status: 400,
      jsonBody: {
        error: `Unsupported file type '.${ext}'. Supported: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
      },
    };
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      status: 400,
      jsonBody: {
        error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum: 25MB`,
      },
    };
  }

  context.log(`Processing file: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);

  // Optional language hint (ISO 639-1 code)
  const language = formData.get("language");
  const languageStr = typeof language === "string" && language.trim() ? language.trim() : undefined;

  // Transcribe via Whisper
  let transcript: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    transcript = await transcribeAudio(buffer, file.name, languageStr);
  } catch (err) {
    context.error("Whisper transcription failed:", err);
    return {
      status: 502,
      jsonBody: { error: "Transcription failed — Azure OpenAI Whisper unavailable" },
    };
  }

  context.log(`Transcription complete: ${transcript.length} chars`);

  const result: TranscribeResponse = {
    transcript,
    filename: file.name,
    fileSizeBytes: file.size,
  };

  return {
    status: 200,
    jsonBody: result,
  };
}

app.http("transcribe", {
  methods: ["POST"],
  authLevel: "function",
  route: "transcribe",
  handler: transcribe,
});
