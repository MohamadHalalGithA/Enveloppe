/**
 * Builds the public /demo from the SYNTHETIC sample letters using the real pipeline:
 *   Gemini reading → Contract Guard → server-side QR decoding → Trust Registry verification →
 *   case threading in a real (in-memory) Postgres → deadlines → process graph → Response Pack.
 * Gemini readings are cached in demo/cache/readings (pass --refresh to read the letters again).
 * Output: demo/cache/results/<letterId>.json, demo/cache/inbox.json, demo/cache/meta.json,
 * and the letter images in public/demo-letters/. The /demo page only reads these files.
 *
 * Usage: npm run demo:build [-- --refresh]
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ExtractionZ, type Extraction, type LetterResult, type SpeechResult } from "@/lib/contracts";
import { resolveUser } from "@/lib/auth/resolve";
import { loadLetterResult } from "@/lib/cases/result";
import { decideCase, getInbox } from "@/lib/cases/service";
import { openPglite } from "@/lib/db/client";
import { createLetter, storeLetterImage } from "@/lib/db/repo";
import { extractFromImage, geminiTranslate } from "@/lib/gemini/client";
import { analyzeLetter } from "@/lib/pipeline/analyze";
import { sanitizeUpload } from "@/lib/upload/sanitize";
import { elevenLabsTts } from "@/lib/voice/elevenlabs";
import { speechLanguage } from "@/lib/voice/languages";
import { buildSpeechScript, fillScript, scrubForSpeech } from "@/lib/voice/script";
import { translateScript } from "@/lib/voice/translate";

try {
  process.loadEnvFile(".env.local");
} catch {
  // env may come from the shell
}

const TODAY = process.env.DEMO_TODAY ?? "2026-09-27";
const REFRESH = process.argv.includes("--refresh");
const ROOT = process.cwd();
const LETTERS = path.join(ROOT, "demo", "letters", "out");
const CACHE = path.join(ROOT, "demo", "cache");
const PUBLIC = path.join(ROOT, "public", "demo-letters");

/** Demo order: the 2023 reassessment is already a case; A becomes a case; B arrives as its scam twin. */
const STEPS: { id: string; file: string; decide: "new" | null }[] = [
  { id: "C", file: "C_cra_reassessment.png", decide: "new" },
  { id: "A", file: "A_cra_ccb_review.png", decide: "new" },
  { id: "B", file: "B_cra_twin_scam.png", decide: null },
  { id: "E", file: "E_low_quality.jpg", decide: null },
  { id: "D", file: "D_ircc_biometrics.png", decide: "new" },
];

/** Saved readings only, not in the public walkthrough: G is CRA's answer to A, for the signed-in live demo. */
const READING_ONLY: { id: string; file: string }[] = [{ id: "G", file: "G_cra_review_outcome.png" }];

async function reading(id: string, image: Buffer): Promise<{ extraction: Extraction; modelId: string | null; cachedAt: string }> {
  const file = path.join(CACHE, "readings", `${id}.extraction.json`);
  if (!REFRESH) {
    try {
      const cached = JSON.parse(await readFile(file, "utf8"));
      return { extraction: ExtractionZ.parse(cached.extraction), modelId: cached.modelId, cachedAt: cached.cachedAt };
    } catch {
      // not cached yet
    }
  }
  console.log(`  reading ${id} with Gemini…`);
  const r = await extractFromImage(image);
  const entry = { extraction: r.extraction, modelId: r.modelId, cachedAt: new Date().toISOString() };
  await writeFile(file, JSON.stringify(entry, null, 2) + "\n");
  return entry;
}

/** The twin-letter pair gets pre-generated voice in the public demo (the demo never calls a service). */
const VOICED = ["A", "B"];
const VOICE_LANGS = ["ar", "fr", "en"];
const AUDIO = path.join(ROOT, "public", "demo-audio");

/**
 * Same path as POST /api/letters/:id/speech: script from the verified result → Gemini translation →
 * placeholders filled by code → scrubbed → ElevenLabs. Reused while the script is unchanged.
 */
async function demoSpeech(sample: string, letter: LetterResult): Promise<Record<string, SpeechResult>> {
  const { ELEVENLABS_API_KEY: apiKey, ELEVENLABS_VOICE_ID: voiceId, ELEVENLABS_MODEL_ID: modelId } = process.env;
  if (!apiKey || !voiceId || !modelId) throw new Error("ElevenLabs settings missing (.env.local)");
  const tts = elevenLabsTts({ apiKey, voiceId, modelId });
  const script = buildSpeechScript(letter);
  await mkdir(AUDIO, { recursive: true });
  await mkdir(path.join(CACHE, "speech-store"), { recursive: true });
  const out: Record<string, SpeechResult> = {};
  for (const code of VOICE_LANGS) {
    const lang = speechLanguage(code)!;
    const hash = createHash("sha256").update(JSON.stringify({ script, code, voiceId, modelId })).digest("hex");
    const storeFile = path.join(CACHE, "speech-store", `${sample}-${code}.json`);
    const audioFile = path.join(AUDIO, `${sample}-${code}.mp3`);
    let text: string | null = null;
    try {
      const stored = JSON.parse(await readFile(storeFile, "utf8"));
      await readFile(audioFile);
      if (stored.hash === hash) text = stored.text;
    } catch {
      // not generated yet
    }
    if (!text) {
      console.log(`  voicing ${sample} in ${lang.english}…`);
      const translated = await translateScript(script.template, code, geminiTranslate);
      text = scrubForSpeech(fillScript(translated, script.values, code), script.values.PHONE ? [script.values.PHONE] : []);
      await writeFile(audioFile, await tts(text));
      await writeFile(storeFile, JSON.stringify({ hash, text }, null, 2) + "\n");
    }
    out[code] = {
      lang: code,
      languageName: lang.name,
      dir: lang.dir,
      text,
      machineTranslated: code !== "en",
      audioUrl: `/demo-audio/${sample}-${code}.mp3`,
      note: null,
    };
  }
  return out;
}

async function main() {
  const refKey = process.env.REF_HMAC_KEY;
  if (!refKey) throw new Error("REF_HMAC_KEY missing (.env.local)");
  await mkdir(path.join(CACHE, "readings"), { recursive: true });
  await rm(path.join(CACHE, "results"), { recursive: true, force: true });
  await mkdir(path.join(CACHE, "results"), { recursive: true });
  await mkdir(PUBLIC, { recursive: true });

  const db = await openPglite(); // throwaway in-memory database, same schema and code paths as the app
  const user = await resolveUser(db, "demo|synthetic-user");
  /** SHA-256 of each exact sample file → its saved reading (the demo fallback, lib/pipeline/cached-reading.ts). */
  const manifest: Record<string, string> = {};
  const built: { id: string; letterId: string; image: { url: string; width: number; height: number }; model: string | null; cachedAt: string }[] = [];

  for (const step of STEPS) {
    const image = await readFile(path.join(LETTERS, step.file));
    const meta = await sharp(image).metadata();
    await copyFile(path.join(LETTERS, step.file), path.join(PUBLIC, step.file));

    const { extraction, modelId, cachedAt } = await reading(step.id, image);
    // Same path as POST /api/letters + /analyze: sanitize, store, then the pipeline with the saved reading.
    const clean = await sanitizeUpload(image);
    manifest[clean.sha256] = step.id;
    const { id: letterId } = await createLetter(db, user.id, clean.sha256);
    await storeLetterImage(db, user.id, letterId, clean, new Date(Date.now() + 86_400_000));
    const analyzed = await analyzeLetter(db, user.id, letterId, {
      extract: async () => ({ extraction, modelId: modelId ?? "cached-reading" }),
      today: () => TODAY,
      refKey,
    });
    if (step.decide) await decideCase(db, user.id, letterId, { decision: step.decide });

    console.log(`  ${step.id}: ${analyzed.verdict} · ${analyzed.caseMatch.decision} · deadline ${analyzed.deadline.effective ?? "—"}`);
    built.push({ id: step.id, letterId, image: { url: `/demo-letters/${step.file}`, width: meta.width!, height: meta.height! }, model: modelId, cachedAt });
  }
  for (const extra of READING_ONLY) {
    const image = await readFile(path.join(LETTERS, extra.file));
    const { extraction } = await reading(extra.id, image);
    manifest[(await sanitizeUpload(image)).sha256] = extra.id;
    console.log(`  ${extra.id}: saved reading only (${extraction.documentType.value ?? "no type"})`);
  }

  const speech: Record<string, Record<string, SpeechResult>> = {};
  for (const b of built) {
    const result = await loadLetterResult(db, user.id, b.letterId, { image: b.image, cached: true });
    await writeFile(path.join(CACHE, "results", `${b.letterId}.json`), JSON.stringify(result, null, 2) + "\n");
    if (VOICED.includes(b.id)) speech[b.letterId] = await demoSpeech(b.id, result);
  }
  await writeFile(path.join(CACHE, "speech.json"), JSON.stringify(speech, null, 2) + "\n");
  await writeFile(path.join(CACHE, "readings", "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(path.join(CACHE, "inbox.json"), JSON.stringify(await getInbox(db, user.id), null, 2) + "\n");
  await writeFile(
    path.join(CACHE, "meta.json"),
    JSON.stringify({ builtAt: new Date().toISOString(), today: TODAY, letters: built.map(({ id, letterId, model, cachedAt }) => ({ id, letterId, model, readAt: cachedAt })) }, null, 2) + "\n",
  );
  console.log(`Demo built: ${built.length} letters → demo/cache (today = ${TODAY}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
