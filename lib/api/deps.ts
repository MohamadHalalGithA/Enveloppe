import "server-only";
import { requireUser } from "@/lib/auth/requireUser";
import { getDb } from "@/lib/db/client";
import { PipelineError } from "@/lib/errors";
import { extractFromImage, geminiTranslate } from "@/lib/gemini/client";
import { todayInToronto } from "@/lib/time";
import { elevenLabsTts, VoiceError } from "@/lib/voice/elevenlabs";
import type { ApiDeps } from "./handlers";
import { RateLimiter } from "./rate-limit";

const limiter = new RateLimiter();

/** Production wiring: Auth0 session, the configured database, the real Gemini reader. */
export function apiDeps(): ApiDeps {
  return {
    user: requireUser,
    db: getDb,
    extract: extractFromImage,
    today: () => todayInToronto(),
    now: () => new Date(),
    refKey: () => {
      const key = process.env.REF_HMAC_KEY;
      if (!key) throw new PipelineError("CONFIG_MISSING", "REF_HMAC_KEY is not set");
      return key;
    },
    // Fails closed: without APP_BASE_URL every mutation is rejected as cross-origin.
    appOrigin: process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).origin : "invalid://missing-app-base-url",
    limiter,
    retentionDays: 30,
    speech: () => {
      const { ELEVENLABS_API_KEY: apiKey, ELEVENLABS_VOICE_ID: voiceId, ELEVENLABS_MODEL_ID: modelId } = process.env;
      return {
        translate: geminiTranslate,
        // Without ElevenLabs configured, speech degrades to text only.
        tts:
          apiKey && voiceId && modelId
            ? elevenLabsTts({ apiKey, voiceId, modelId })
            : async () => {
                throw new VoiceError("Voice not configured");
              },
        now: () => new Date(),
        voiceKey: `${voiceId ?? "none"}:${modelId ?? "none"}`,
      };
    },
  };
}
