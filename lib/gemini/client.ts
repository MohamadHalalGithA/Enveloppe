import "server-only";
import { GoogleGenAI, MediaResolution, ThinkingLevel } from "@google/genai";
import { PipelineError } from "@/lib/errors";
import { todayInToronto } from "@/lib/time";
import { extractLetter, type ExtractResult, type GenerateFn } from "./extract";
import { assertModelImage } from "./image";
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_PROMPT } from "./prompt";
import { EXTRACTION_RESPONSE_SCHEMA } from "./schema";

/**
 * The only code that sends a letter image to Gemini. It sends the image and the fixed prompt,
 * nothing else: no user identity, no case history, no other letters.
 */

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new PipelineError("CONFIG_MISSING", "GEMINI_API_KEY is not set");
  client = new GoogleGenAI({ apiKey });
  return client;
}

export function configuredModels(): string[] {
  return [process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODEL].filter((m): m is string => !!m);
}

export const geminiGenerate: GenerateFn = async ({ model, image, mimeType, promptSuffix, signal }) => {
  const res = await getClient().models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ inlineData: { mimeType, data: image.toString("base64") } }, { text: EXTRACTION_USER_PROMPT + promptSuffix }],
      },
    ],
    config: {
      systemInstruction: EXTRACTION_SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseJsonSchema: EXTRACTION_RESPONSE_SCHEMA,
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      abortSignal: signal,
      httpOptions: { retryOptions: { attempts: 1 } }, // retries are handled by extractLetter
    },
  });
  const text = res.text;
  if (!text) throw Object.assign(new Error("Empty model response"), { status: 502 });
  return text;
};

/** image bytes → validated, guarded Extraction. */
export async function extractFromImage(image: Buffer): Promise<ExtractResult> {
  const mimeType = assertModelImage(image);
  return extractLetter(image, mimeType, {
    models: configuredModels(),
    generate: geminiGenerate,
    today: todayInToronto(),
  });
}
