import { readFile } from "node:fs/promises";
import path from "node:path";
import { ExtractionZ, type Extraction } from "@/lib/contracts";

/**
 * Demo fallback (Blueprint Part 33, "Plan B/C"): saved Gemini readings of the SYNTHETIC sample letters,
 * matched by the SHA-256 of the exact uploaded file. A real user's photo never matches, so this can only
 * ever answer for our own sample files. Results using it are badged "Cached reading" in the UI.
 *
 * DEMO_MODE: "fallback" (or "true") = use a saved reading only when Gemini fails;
 *            "offline" = use it whenever one exists (no network needed); anything else = off.
 */

export const CACHED_MODEL_ID = "cached-reading";
const DIR = path.join(process.cwd(), "demo", "cache", "readings");

export type DemoReadingMode = "off" | "fallback" | "offline";

export function demoReadingMode(value = process.env.DEMO_MODE): DemoReadingMode {
  if (value === "offline") return "offline";
  if (value === "fallback" || value === "true") return "fallback";
  return "off";
}

export async function cachedReadingFor(imageSha256: string): Promise<{ extraction: Extraction; modelId: string } | null> {
  if (!/^[0-9a-f]{64}$/.test(imageSha256)) return null;
  try {
    const manifest = JSON.parse(await readFile(path.join(DIR, "manifest.json"), "utf8")) as Record<string, string>;
    const sample = manifest[imageSha256];
    if (!sample || !/^[A-Z]$/.test(sample)) return null;
    const cached = JSON.parse(await readFile(path.join(DIR, `${sample}.extraction.json`), "utf8"));
    return { extraction: ExtractionZ.parse(cached.extraction), modelId: CACHED_MODEL_ID };
  } catch {
    return null;
  }
}
