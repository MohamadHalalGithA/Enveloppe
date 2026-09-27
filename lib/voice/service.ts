import { createHash } from "node:crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { SpeechResult } from "@/lib/contracts";
import { voiceClips } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { letterResultFor } from "@/lib/pipeline/analyze";
import { VoiceError, type TtsFn } from "./elevenlabs";
import { speechLanguage } from "./languages";
import { buildSpeechScript, fillScript, scrubForSpeech } from "./script";
import { translateScript, type TranslateFn } from "./translate";

/**
 * "Listen in my language": verified result → deterministic English script → translation (Gemini, text only)
 * → placeholders filled by code → scrubbed → ElevenLabs → cached per (letter, language, content).
 * Degrades gracefully: no voice → text only; no translation → English.
 */

export interface SpeechDeps {
  translate: TranslateFn;
  tts: TtsFn;
  now: () => Date;
  /** Distinguishes cached clips when the voice or model changes. */
  voiceKey: string;
}

export function speechAudioUrl(letterId: string, lang: string) {
  return `/api/letters/${letterId}/speech?lang=${lang}`;
}

export async function speakLetter(db: Db, userId: string, letterId: string, lang: string, deps: SpeechDeps): Promise<SpeechResult> {
  const language = speechLanguage(lang);
  if (!language) throw new VoiceError("Unsupported language");
  const letter = await letterResultFor(db, userId, letterId, deps.now()); // owner-scoped; 404 / 409 otherwise
  const script = buildSpeechScript(letter);
  const hash = createHash("sha256")
    .update(JSON.stringify({ script, lang: language.code, voice: deps.voiceKey }))
    .digest("hex");
  const allowedPhones = script.values.PHONE ? [script.values.PHONE] : [];

  const [cached] = await db
    .select()
    .from(voiceClips)
    .where(and(eq(voiceClips.letterId, letterId), eq(voiceClips.userId, userId), eq(voiceClips.lang, language.code), eq(voiceClips.textSha256, hash)));

  let text = cached?.text ?? null;
  let notes: string[] = [];
  let spokenLang = language;
  if (!text) {
    try {
      const translated = await translateScript(script.template, language.code, deps.translate);
      text = scrubForSpeech(fillScript(translated, script.values, language.code), allowedPhones);
    } catch {
      // Translation unavailable: fall back to the English text rather than nothing.
      spokenLang = speechLanguage("en")!;
      text = scrubForSpeech(fillScript(script.template, script.values, "en"), allowedPhones);
      notes = [`A ${language.english} translation isn't available right now, so here it is in English.`];
    }
  }

  let audio: Buffer | null = cached?.audio ? Buffer.from(cached.audio) : null;
  if (!audio) {
    try {
      audio = await deps.tts(text);
    } catch {
      audio = null;
      notes.push("Voice is unavailable right now. The text says the same thing.");
    }
  }

  // Cache under the language the user asked for (only when that language was actually produced).
  if (spokenLang.code === language.code) {
    await db
      .insert(voiceClips)
      .values({ letterId, userId, lang: language.code, textSha256: hash, text, audio })
      .onConflictDoUpdate({
        target: [voiceClips.letterId, voiceClips.lang, voiceClips.textSha256],
        set: { text, audio },
        setWhere: eq(voiceClips.userId, userId),
      });
  }

  return {
    lang: spokenLang.code,
    languageName: spokenLang.name,
    dir: spokenLang.dir,
    text,
    machineTranslated: spokenLang.code !== "en",
    audioUrl: audio && spokenLang.code === language.code ? speechAudioUrl(letterId, language.code) : null,
    note: notes.join(" ") || null,
  };
}

/** The most recent voiced clip for this letter and language (owner only). */
export async function getSpeechAudio(db: Db, userId: string, letterId: string, lang: string): Promise<Buffer | null> {
  const [row] = await db
    .select({ audio: voiceClips.audio })
    .from(voiceClips)
    .where(and(eq(voiceClips.letterId, letterId), eq(voiceClips.userId, userId), eq(voiceClips.lang, lang), isNotNull(voiceClips.audio)))
    .orderBy(desc(voiceClips.createdAt))
    .limit(1);
  return row?.audio ? Buffer.from(row.audio) : null;
}
