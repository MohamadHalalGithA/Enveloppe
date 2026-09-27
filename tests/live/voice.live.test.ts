/**
 * Live voice: real Gemini translation + real ElevenLabs speech for a filed synthetic letter.
 * Costs a few hundred ElevenLabs characters per run.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resolveUser } from "@/lib/auth/resolve";
import { fileAnalyzedLetter } from "@/lib/cases/service";
import { openPglite } from "@/lib/db/client";
import { createLetter } from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";
import { geminiTranslate } from "@/lib/gemini/client";
import { elevenLabsTts } from "@/lib/voice/elevenlabs";
import { getSpeechAudio, speakLetter } from "@/lib/voice/service";
import { letterA } from "../helpers/extractions";

try {
  process.loadEnvFile(".env.local");
} catch {
  // env may come from the shell
}

let db: Db;
let userId: string;
let letterId: string;

beforeAll(async () => {
  db = await openPglite();
  userId = (await resolveUser(db, "auth0|live-voice")).id;
  letterId = (await createLetter(db, userId, "l".repeat(64))).id;
  await fileAnalyzedLetter(db, userId, letterId, { extraction: letterA(), qr: [] }, { today: "2026-09-27", refKey: "live-voice-key-".repeat(4) });
}, 60_000);

describe("live: Listen in Arabic", () => {
  it("translates the verified explanation and voices it", async () => {
    const { ELEVENLABS_API_KEY: apiKey, ELEVENLABS_VOICE_ID: voiceId, ELEVENLABS_MODEL_ID: modelId } = process.env;
    const r = await speakLetter(db, userId, letterId, "ar", {
      translate: geminiTranslate,
      tts: elevenLabsTts({ apiKey: apiKey!, voiceId: voiceId!, modelId: modelId! }),
      now: () => new Date(),
      voiceKey: `${voiceId}:${modelId}`,
    });
    expect(r).toMatchObject({ lang: "ar", dir: "rtl", machineTranslated: true, note: null });
    expect(r.text).toMatch(/[؀-ۿ]/); // Arabic script
    expect(r.text).toContain("1-800-387-1193"); // filled by code, not translated
    for (const f of ["4471", "5831", "Amira", "Example Street"]) expect(r.text).not.toContain(f);

    const audio = (await getSpeechAudio(db, userId, letterId, "ar"))!;
    expect(audio.length).toBeGreaterThan(10_000);
    const header = audio.subarray(0, 3).toString("latin1");
    expect(header === "ID3" || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0)).toBe(true); // MP3
  });
});
