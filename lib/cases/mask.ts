import type { Extraction } from "@/lib/contracts";

/** "2026-CCB-5831-4471" → "••••-•••-••••-4471": only the last 4 characters stay readable. */
export function maskReference(value: string): string {
  let keep = 4;
  return [...value]
    .reverse()
    .map((ch) => {
      if (!/[A-Za-z0-9]/.test(ch)) return ch;
      if (keep > 0) {
        keep--;
        return ch;
      }
      return "•";
    })
    .reverse()
    .join("");
}

/**
 * What gets persisted: identifiers are masked in both value and quote. Matching uses the HMAC digest
 * computed from the unmasked value before this runs; the full reference number is never stored.
 */
export function redactExtractionForStorage(x: Extraction): Extraction {
  const out = structuredClone(x);
  for (const id of out.identifiers) {
    if (!id.value) continue;
    const masked = maskReference(id.value);
    if (id.sourceText) id.sourceText = id.sourceText.split(id.value).join(masked);
    id.value = masked;
  }
  return out;
}
