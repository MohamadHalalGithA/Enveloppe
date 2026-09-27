import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { InboxZ, LetterResultZ, SpeechResultZ, type Inbox, type LetterResult, type SpeechResult } from "@/lib/contracts";

/**
 * Public demo data: results the real pipeline produced for the SYNTHETIC sample letters
 * (npm run demo:build). No user data, no database, no model calls at request time.
 */

const DIR = path.join(process.cwd(), "demo", "cache");

export async function getDemoInbox(): Promise<Inbox | null> {
  try {
    return InboxZ.parse(JSON.parse(await readFile(path.join(DIR, "inbox.json"), "utf8")));
  } catch {
    return null;
  }
}

export async function getDemoLetter(id: string): Promise<LetterResult | null> {
  // Only a UUID can become part of the file path: no traversal, no arbitrary reads.
  if (!z.uuid().safeParse(id).success) return null;
  try {
    return LetterResultZ.parse(JSON.parse(await readFile(path.join(DIR, "results", `${id}.json`), "utf8")));
  } catch {
    return null;
  }
}

export async function getDemoMeta(): Promise<{ builtAt: string; today: string } | null> {
  try {
    return JSON.parse(await readFile(path.join(DIR, "meta.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Pre-generated spoken explanations for a demo letter, by language (only the twin-letter pair has them). */
export async function getDemoSpeech(id: string): Promise<Record<string, SpeechResult> | undefined> {
  if (!z.uuid().safeParse(id).success) return undefined;
  try {
    const all = JSON.parse(await readFile(path.join(DIR, "speech.json"), "utf8")) as Record<string, unknown>;
    const entry = all[id];
    return entry ? z.record(z.string(), SpeechResultZ).parse(entry) : undefined;
  } catch {
    return undefined;
  }
}
