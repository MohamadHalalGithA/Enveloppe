/**
 * Rehearses the twin-letter demo end to end through the real API handlers, several times, and reports
 * timings and failures. Uses real Gemini + ElevenLabs (like the live demo); only sign-in is substituted.
 * Each run uses a fresh in-memory database, so nothing real is touched.
 *
 *   npm run demo:rehearse -- --runs 5            full rehearsal (costs a few cents per run)
 *   npm run demo:rehearse -- --runs 3 --offline  saved readings, no Gemini (tests Plan C)
 *   npm run demo:rehearse -- --no-voice          skip ElevenLabs
 */
import { readFile } from "node:fs/promises";
import { CaseDetailZ, LetterResultZ, SpeechResultZ, UploadResultZ } from "@/lib/contracts";
import * as api from "@/lib/api/handlers";
import type { ApiDeps } from "@/lib/api/handlers";
import { RateLimiter } from "@/lib/api/rate-limit";
import { resolveUser } from "@/lib/auth/resolve";
import { openPglite } from "@/lib/db/client";
import { extractFromImage, geminiTranslate } from "@/lib/gemini/client";
import { cachedReadingFor } from "@/lib/pipeline/cached-reading";
import { todayInToronto } from "@/lib/time";
import { elevenLabsTts } from "@/lib/voice/elevenlabs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // env may come from the shell
}

const ORIGIN = "http://localhost:3000";
const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 1;
const offline = process.argv.includes("--offline");
const voice = !process.argv.includes("--no-voice");

function check(ok: boolean, what: string) {
  if (!ok) throw new Error(`Expected: ${what}`);
}

async function rehearse(): Promise<Record<string, number>> {
  const db = await openPglite();
  const user = await resolveUser(db, "rehearsal|demo");
  const { ELEVENLABS_API_KEY: apiKey, ELEVENLABS_VOICE_ID: voiceId, ELEVENLABS_MODEL_ID: modelId } = process.env;
  const deps: ApiDeps = {
    user: async () => user,
    db: async () => db,
    extract: extractFromImage,
    today: () => todayInToronto(),
    now: () => new Date(),
    refKey: () => process.env.REF_HMAC_KEY!,
    appOrigin: ORIGIN,
    limiter: new RateLimiter(),
    retentionDays: 30,
    cachedReadings: { cachedReading: cachedReadingFor, cachedMode: offline ? "offline" : "fallback" },
    speech: () => ({
      translate: geminiTranslate,
      tts: elevenLabsTts({ apiKey: apiKey!, voiceId: voiceId!, modelId: modelId! }),
      now: () => new Date(),
      voiceKey: `${voiceId}:${modelId}`,
    }),
  };
  const t: Record<string, number> = {};
  const time = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
    const s = performance.now();
    try {
      return await fn();
    } finally {
      t[step] = Math.round(performance.now() - s);
    }
  };
  const post = (url: string, body: unknown) => {
    const text = JSON.stringify(body);
    return new Request(`${ORIGIN}${url}`, {
      method: "POST",
      body: text,
      headers: { origin: ORIGIN, "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) },
    });
  };
  const upload = async (file: string) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(await readFile(`demo/letters/out/${file}`))], file));
    const encoded = new Response(form);
    const body = Buffer.from(await encoded.arrayBuffer());
    const res = await api.uploadLetter(
      new Request(`${ORIGIN}/api/letters`, {
        method: "POST",
        body,
        headers: { origin: ORIGIN, "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length) },
      }),
      deps,
    );
    return UploadResultZ.parse(await res.json()).letterId;
  };
  const analyze = async (id: string) => {
    const res = await api.analyze(post(`/api/letters/${id}/analyze`, {}), id, deps);
    check(res.status === 200, `analyze → 200 (got ${res.status})`);
    return LetterResultZ.parse(await res.json());
  };

  const a = await time("A: upload + read", async () => analyze(await upload("A_cra_ccb_review.png")));
  check(a.verdict === "CONSISTENT_WITH_TRUSTED_SOURCES", "A matches trusted sources");
  const filed = LetterResultZ.parse(await (await api.decide(post(`/api/letters/${a.id}/case`, { decision: "new" }), a.id, deps)).json());
  check(!!filed.filedIn, "A becomes a case");

  const b = await time("B: upload + read", async () => analyze(await upload("B_cra_twin_scam.png")));
  check(b.verdict === "CONTRADICTIONS_FOUND", "B contradicts trusted sources");
  check(b.caseMatch.decision === "ASK_CONFLICT", "B conflicts with A's case");
  const hard = b.items.filter((i) => i.strength === "HARD").map((i) => i.claimType).sort().join(",");
  check(hard === "payment,phone,qr", `B hard contradictions are payment, phone, QR (got ${hard})`);
  await api.decide(post(`/api/letters/${b.id}/case`, { decision: "keep_separate" }), b.id, deps);

  if (voice) {
    const s = await time("B: listen in Arabic", async () =>
      SpeechResultZ.parse(await (await api.speak(post(`/api/letters/${b.id}/speech`, { lang: "ar" }), b.id, deps)).json()),
    );
    check(s.lang === "ar" && !!s.audioUrl, "Arabic voice for B");
  }

  const detail = CaseDetailZ.parse(await (await api.caseDetail(new Request(`${ORIGIN}/x`), filed.filedIn!.caseId, deps)).json());
  const task = detail.tasks[0].id;
  const after = CaseDetailZ.parse(
    await (await api.completeTask(post(`/api/tasks/${task}/complete`, { confirmationNumber: "REHEARSAL-1" }), task, deps)).json(),
  );
  check(after.case.status === "WAITING_FOR_GOVERNMENT", "case moves to waiting after proof");
  t["cached reading used"] = a.cached || b.cached ? 1 : 0;
  return t;
}

async function main() {
  console.log(`Rehearsing the twin-letter demo ${runs}× (${offline ? "saved readings" : "live Gemini"}${voice ? " + ElevenLabs" : ""})…`);
  let failures = 0;
  for (let i = 1; i <= runs; i++) {
    try {
      const t = await rehearse();
      const cached = t["cached reading used"] ? " (a saved reading was used)" : "";
      delete t["cached reading used"];
      console.log(`  run ${i}: OK  ${Object.entries(t).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join(" · ")}${cached}`);
    } catch (e) {
      failures++;
      console.log(`  run ${i}: FAILED  ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(failures ? `${failures}/${runs} runs failed.` : `All ${runs} runs passed.`);
  process.exit(failures ? 1 : 0);
}

void main();
