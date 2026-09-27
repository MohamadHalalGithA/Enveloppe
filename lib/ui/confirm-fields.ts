import type { LetterResult } from "@/lib/contracts";

/**
 * Maps the pipeline's "please confirm" list onto the fields the confirm API accepts
 * (POST /api/letters/:id/confirm). Anything else is shown as "check against your letter" only.
 */

export type ConfirmInput =
  | { key: "issueDate"; kind: "date"; label: string; printed: string | null }
  | { key: "printedDeadline"; kind: "date"; label: string; printed: string | null }
  | { key: "taxYear"; kind: "year"; label: string; printed: string | null }
  | { key: "reference"; kind: "text"; label: string; printed: string | null };

export function confirmInputs(fields: LetterResult["needsConfirmation"]): { editable: ConfirmInput[]; checkOnly: LetterResult["needsConfirmation"] } {
  const editable: ConfirmInput[] = [];
  const checkOnly: LetterResult["needsConfirmation"] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    const input: ConfirmInput | null =
      f.path === "issueDate"
        ? { key: "issueDate", kind: "date", label: f.label, printed: f.value }
        : f.path === "printedDeadlines[0]"
          ? { key: "printedDeadline", kind: "date", label: f.label, printed: f.value }
          : f.path === "taxYear"
            ? { key: "taxYear", kind: "year", label: f.label, printed: f.value }
            : /^identifiers\[\d+\]$/.test(f.path)
              ? { key: "reference", kind: "text", label: f.label, printed: f.value }
              : null;
    if (!input) checkOnly.push(f);
    else if (!seen.has(input.key)) {
      seen.add(input.key);
      editable.push(input);
    }
  }
  return { editable, checkOnly };
}

/** Builds the API body from what the user typed; empty inputs are left out. */
export function confirmBody(values: Record<string, string>): Record<string, string | number> {
  const body: Record<string, string | number> = {};
  for (const [k, raw] of Object.entries(values)) {
    const v = raw.trim();
    if (!v) continue;
    body[k] = k === "taxYear" ? Number(v) : v;
  }
  return body;
}
