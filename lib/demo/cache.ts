import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { InboxZ, LetterResultZ, type Inbox, type LetterResult } from "@/lib/contracts";

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
