import { createHmac } from "node:crypto";
import type { Extraction } from "@/lib/contracts";

/**
 * Reference numbers are stored as HMAC(REF_HMAC_KEY, normalized) plus the last 4 characters for display.
 * Matching works on the digest; the full number is never persisted.
 */

export interface RefDigest {
  hmac: string;
  last4: string;
}

const PREFERENCE = ["reference_number", "case_number", "application_number", "client_id"] as const;

export function normalizeReference(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function digestReference(value: string, key: string): RefDigest | null {
  if (!key || key.length < 32) throw new Error("REF_HMAC_KEY is missing or too short");
  const n = normalizeReference(value);
  if (n.length < 4) return null;
  return { hmac: createHmac("sha256", key).update(n).digest("hex"), last4: n.slice(-4) };
}

/** The identifier that best names the letter's case, and whether we're unsure we read it correctly. */
export function pickReference(x: Extraction): { field: Extraction["identifiers"][number]; uncertain: boolean } | null {
  for (const kind of PREFERENCE) {
    const f = x.identifiers.find((i) => i.kind === kind && i.value);
    if (f) return { field: f, uncertain: f.needsConfirmation || f.confidence === "low" };
  }
  return null;
}
