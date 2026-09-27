import { readdir, readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LetterResultZ, type LetterResult } from "@/lib/contracts";
import { resolveUser } from "@/lib/auth/resolve";
import { fileAnalyzedLetter } from "@/lib/cases/service";
import { openPglite } from "@/lib/db/client";
import { createLetter } from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";
import { NotFoundError } from "@/lib/errors";
import { elevenLabsTts, VoiceError } from "@/lib/voice/elevenlabs";
import { buildSpeechScript, fillScript, scrubForSpeech } from "@/lib/voice/script";
import { getSpeechAudio, speakLetter, type SpeechDeps } from "@/lib/voice/service";
import { asciiDigits, TranslationError, translateScript, validateTranslation } from "@/lib/voice/translate";
import { letterA, letterB } from "../helpers/extractions";

/** Real pipeline output from the demo build: A (consistent, filed) and B (the scam twin). */
async function demoResults(): Promise<{ a: LetterResult; b: LetterResult }> {
  const files = await readdir("demo/cache/results");
  const all = await Promise.all(files.map(async (f) => LetterResultZ.parse(JSON.parse(await readFile(`demo/cache/results/${f}`, "utf8")))));
  return {
    a: all.find((r) => r.whatIsThis.docTypeLabel.startsWith("Request for documents") && r.status === "SUCCESS")!,
    b: all.find((r) => r.verdict === "CONTRADICTIONS_FOUND")!,
  };
}
const FORBIDDEN = ["4471", "8902", "5831", "7715", "Amira", "Example Street", "555-0147", "1,284", "cra-canada-verify", "Reference"];

describe("spoken script (built from the verified result, never the letter)", () => {
  it("Sample A: what it is, what to do, by when, official number, as placeholders", async () => {
    const { a } = await demoResults();
    const s = buildSpeechScript(a);
    expect(s.template).toMatch(/^This is a request for documents from the Canada Revenue Agency/);
    expect(s.template).toContain("Send them through CRA Submit documents online.");
    expect(s.template).toContain("The deadline is {{DEADLINE}}. That is {{DAYS}} days from today.");
    expect(s.values).toEqual({ PHONE: "1-800-387-1193", DEADLINE: "2026-10-14", DAYS: 17 });
    for (const f of FORBIDDEN) expect(s.template).not.toContain(f);
  });

  it("Sample B: warns without repeating anything from the letter, points to the verified number", async () => {
    const { b } = await demoResults();
    const s = buildSpeechScript(b);
    expect(s.template).toContain("do not match official information");
    expect(s.template).toContain("Do not call the phone number, scan the code, or send money using anything in this letter.");
    expect(s.template).toContain("call CRA yourself at {{PHONE}}");
    expect(s.values).toEqual({ PHONE: "1-800-387-1193" });
    for (const f of FORBIDDEN) expect(s.template).not.toContain(f);
  });

  it("an old letter: says the date has passed instead of reading out steps as if they were still open", async () => {
    const { a } = await demoResults();
    const passed = { ...a.deadline, effective: "2026-09-01", daysRemaining: -26, status: "PASSED" as const };
    const s = buildSpeechScript({ ...a, deadline: passed });
    expect(s.template).toBe(
      "This is a request for documents from the Canada Revenue Agency, about the Canada child benefit. " +
        "The deadline for this letter was {{DEADLINE}}. That date has passed. To ask what you can still do, call CRA at {{PHONE}}.",
    );
    expect(s.values).toEqual({ PHONE: "1-800-387-1193", DEADLINE: "2026-09-01" });

    const objection = buildSpeechScript({ ...a, deadline: passed, responsePack: { ...a.responsePack!, action: { type: "file_objection", label: "x" } } });
    expect(objection.template).toContain("If you disagree with it, you can still ask for more time to object.");
  });

  it("fills dates and numbers with the language's own formatting, not a model's", () => {
    const t = "The deadline is {{DEADLINE}}. {{DAYS}} days. Call {{PHONE}}.";
    const v = { DEADLINE: "2026-10-14", DAYS: 17, PHONE: "1-800-387-1193" };
    expect(fillScript(t, v, "en")).toBe("The deadline is October 14, 2026. 17 days. Call 1-800-387-1193.");
    expect(fillScript(t, v, "fr")).toContain("14 octobre 2026");
    expect(fillScript(t, v, "ar")).toContain("أكتوبر");
  });

  it("scrubs emails, links and long numbers, but keeps the official phone and short numbers", () => {
    const text = "Email help@cra-help.example or visit https://x.example now. Ref 2026-CCB-5831-4471. Call 1-800-387-1193 within 17 days, by 2026.";
    const out = scrubForSpeech(text, ["1-800-387-1193"]);
    expect(out).not.toMatch(/help@|https:|5831|4471/);
    expect(out).toContain("1-800-387-1193");
    expect(out).toContain("17 days");
  });
});

describe("translation checks", () => {
  const source = "The deadline is {{DEADLINE}}. Call {{PHONE}}. This is about the 2023 tax year.";
  it("requires every placeholder, exactly once each", () => {
    expect(validateTranslation(source, "La date limite est {{DEADLINE}}. Appelez {{PHONE}}. Année 2023.")).toBe(true);
    expect(validateTranslation(source, "La date limite est le 14 octobre. Appelez {{PHONE}}. Année 2023.")).toBe(false);
    expect(validateTranslation(source, "{{DEADLINE}} {{DEADLINE}} {{PHONE}} 2023")).toBe(false);
  });

  it("rejects invented numbers but accepts the source's numbers in another digit system", () => {
    expect(validateTranslation(source, "{{DEADLINE}} {{PHONE}} 2023 — 500 $")).toBe(false);
    expect(validateTranslation(source, "{{DEADLINE}} {{PHONE}} ٢٠٢٣")).toBe(true);
    expect(asciiDigits("٢٠٢٣ ۱۴ १७")).toBe("2023 14 17");
  });

  it("passes English through, retries once, then gives up", async () => {
    const translate = vi.fn();
    expect(await translateScript("Hi {{PHONE}}", "en", translate)).toBe("Hi {{PHONE}}");
    expect(translate).not.toHaveBeenCalled();
    translate.mockResolvedValueOnce("Bonjour").mockResolvedValueOnce("Bonjour {{PHONE}}");
    expect(await translateScript("Hi {{PHONE}}", "fr", translate)).toBe("Bonjour {{PHONE}}");
    translate.mockResolvedValue("no placeholder");
    await expect(translateScript("Hi {{PHONE}}", "fr", translate)).rejects.toBeInstanceOf(TranslationError);
    await expect(translateScript("Hi", "xx", translate)).rejects.toBeInstanceOf(TranslationError);
  });
});

describe("ElevenLabs client", () => {
  it("sends only the text and model to the voice endpoint", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array(4096), { headers: { "content-type": "audio/mpeg" } }));
    const tts = elevenLabsTts({ apiKey: "k", voiceId: "voice-1", modelId: "eleven_multilingual_v2", fetchFn: fetchFn as unknown as typeof fetch });
    expect((await tts("Bonjour")).length).toBe(4096);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128");
    expect(JSON.parse(init.body as string)).toEqual({ text: "Bonjour", model_id: "eleven_multilingual_v2" });
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
  });

  it("treats errors and non-audio responses as 'voice unavailable'", async () => {
    const bad = elevenLabsTts({ apiKey: "k", voiceId: "v", modelId: "m", fetchFn: (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch });
    await expect(bad("x")).rejects.toBeInstanceOf(VoiceError);
    const html = elevenLabsTts({ apiKey: "k", voiceId: "v", modelId: "m", fetchFn: (async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch });
    await expect(html("x")).rejects.toBeInstanceOf(VoiceError);
  });
});

describe("speakLetter (with a real database)", () => {
  let db: Db;
  let userId: string;
  let letterId: string;
  const spoken: string[] = [];
  const deps = (over: Partial<SpeechDeps> = {}): SpeechDeps => ({
    translate: vi.fn(async ({ text }) => `[ar] ${text}`),
    tts: vi.fn(async (text: string) => {
      spoken.push(text);
      return Buffer.alloc(2048, 1);
    }),
    now: () => new Date("2026-09-27T15:00:00Z"),
    voiceKey: "voice:model",
    ...over,
  });

  beforeAll(async () => {
    db = await openPglite();
    userId = (await resolveUser(db, "auth0|voice-user")).id;
    letterId = (await createLetter(db, userId, "v".repeat(64))).id;
    await fileAnalyzedLetter(db, userId, letterId, { extraction: letterA(), qr: [] }, { today: "2026-09-27", refKey: "voice-test-key-".repeat(4) });
  }, 60_000);

  it("translates, voices and caches; the voice service never sees the letter's identifiers", async () => {
    const d = deps();
    const first = await speakLetter(db, userId, letterId, "ar", d);
    expect(first).toMatchObject({ lang: "ar", dir: "rtl", machineTranslated: true, audioUrl: `/api/letters/${letterId}/speech?lang=ar`, note: null });
    expect(first.text).toContain("1-800-387-1193");
    for (const f of FORBIDDEN) expect(spoken.join(" ")).not.toContain(f);

    const again = await speakLetter(db, userId, letterId, "ar", d);
    expect(again.text).toBe(first.text);
    expect(d.translate).toHaveBeenCalledTimes(1);
    expect(d.tts).toHaveBeenCalledTimes(1);
    expect((await getSpeechAudio(db, userId, letterId, "ar"))?.length).toBe(2048);
  });

  it("without voice, still returns the text (and retries the audio next time)", async () => {
    const r = await speakLetter(db, userId, letterId, "fr", deps({ tts: async () => Promise.reject(new VoiceError()) }));
    expect(r).toMatchObject({ lang: "fr", audioUrl: null });
    expect(r.note).toMatch(/Voice is unavailable/);
    const retry = await speakLetter(db, userId, letterId, "fr", deps());
    expect(retry.audioUrl).not.toBeNull();
  });

  it("without translation, falls back to English and says so", async () => {
    const r = await speakLetter(db, userId, letterId, "zh", deps({ translate: async () => Promise.reject(new Error("down")) }));
    expect(r).toMatchObject({ lang: "en", machineTranslated: false });
    expect(r.note).toMatch(/isn't available right now/);
    expect(r.text).toMatch(/^This is a request for documents/);
  });

  it("is scoped to the letter's owner", async () => {
    const other = (await resolveUser(db, "auth0|voice-other")).id;
    await expect(speakLetter(db, other, letterId, "ar", deps())).rejects.toBeInstanceOf(NotFoundError);
    expect(await getSpeechAudio(db, other, letterId, "ar")).toBeNull();
  });

  it("the scam twin's spoken warning carries none of its contact details", async () => {
    const id = (await createLetter(db, userId, "w".repeat(64))).id;
    await fileAnalyzedLetter(
      db,
      userId,
      id,
      { extraction: letterB(), qr: [{ box: null, page: 1, nearbyText: null, decoded: "https://cra-canada-verify.example/ccb?ref=8902" }] },
      { today: "2026-09-27", refKey: "voice-test-key-".repeat(4) },
    );
    spoken.length = 0;
    const r = await speakLetter(db, userId, id, "en", deps());
    expect(r.text).toContain("call CRA yourself at 1-800-387-1193");
    for (const f of FORBIDDEN) expect(spoken.join(" ")).not.toContain(f);
  });
});
