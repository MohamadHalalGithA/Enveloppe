import type { AgencyCode, CaseMatch, CivilDate, Extraction, VerificationItem } from "@/lib/contracts";
import { addDays } from "@/lib/deadlines/calendar";
import { usable } from "@/lib/deadlines/rules";
import { normalizePhone } from "@/lib/phone";
import { processById } from "@/lib/processes/engine";
import type { Registry } from "@/lib/registry/load";
import { findContact } from "@/lib/registry/lookup";
import { programTitle, programsMatch } from "./labels";
import type { RefDigest } from "./reference";

/**
 * Case threading + scam-in-context (Blueprint Part 11). Deterministic scoring against the user's own
 * cases. Only an exact reference match with no conflicts, on a letter without registry contradictions,
 * links automatically. Everything else asks the user. Nothing is merged silently.
 */

export interface CaseCandidate {
  id: string;
  title: string;
  agencyId: AgencyCode;
  processId: string | null;
  stageId: string | null;
  program: string | null;
  period: string | null;
  referenceHmac: string | null;
  referenceLast4: string | null;
  createdOn: CivilDate;
  latestLetterDate: CivilDate | null;
  /** Phone numbers (E.164) that matched the registry on letters already in this case. */
  verifiedPhones: string[];
}

export interface ThreadingInput {
  x: Extraction;
  registry: Registry;
  candidates: CaseCandidate[];
  letterRef: RefDigest | null;
  refUncertain: boolean;
  /** The registry already found hard/strong contradictions in this letter. */
  registryContradictions: boolean;
}

export interface ThreadingResult {
  match: CaseMatch;
  /** Case-file evidence for the Verification Ledger. */
  items: VerificationItem[];
}

const AUTO_LINK_SCORE = 100;
const ASK_SCORE = 40;

interface Scored {
  c: CaseCandidate;
  score: number;
  refMatch: boolean;
  reasons: string[];
  conflicts: CaseMatch["conflicts"];
  programMatch: boolean;
}

function score(input: ThreadingInput, c: CaseCandidate): Scored {
  const { x, letterRef, refUncertain } = input;
  const reasons: string[] = [];
  let s = 0;
  const refMatch = !!letterRef && !refUncertain && !!c.referenceHmac && letterRef.hmac === c.referenceHmac;
  if (refMatch) {
    s += 100;
    reasons.push("Reference number matches");
  }
  s += 10;
  reasons.push("Same agency");
  const program = usable(x.program);
  const programMatch = programsMatch(program, c.program);
  if (programMatch) {
    s += 30;
    reasons.push(`Same program (${programTitle(program) ?? program})`);
  }
  const docType = x.documentType.value;
  if (docType && processById(c.processId)?.triggers[docType]) {
    s += 25;
    reasons.push("Same kind of process");
  }
  const period = usable(x.taxYear)?.toString() ?? null;
  if (period && c.period && period === c.period) {
    s += 20;
    reasons.push(`Same year (${period})`);
  }
  const issued = usable(x.issueDate);
  if (issued && c.latestLetterDate && issued >= c.latestLetterDate) s += 5;
  if (issued && issued < addDays(c.createdOn, -365)) s -= 30;

  const conflicts: CaseMatch["conflicts"] = [];
  if (s - (refMatch ? 100 : 0) >= ASK_SCORE || refMatch) {
    if (letterRef && !refUncertain && c.referenceHmac && !refMatch) {
      conflicts.push({
        caseId: c.id,
        kind: "REFERENCE_MISMATCH",
        detail: `Reference …${letterRef.last4} vs your case …${c.referenceLast4 ?? "????"}`,
      });
    }
    if (period && c.period && period !== c.period) {
      conflicts.push({ caseId: c.id, kind: "PERIOD_MISMATCH", detail: `Year ${period} vs your case ${c.period}` });
    }
    if (c.verifiedPhones.length) {
      for (const f of x.phones) {
        const e164 = f.value && !f.needsConfirmation ? normalizePhone(f.value).e164 : null;
        const official = e164 ? findContact(input.registry, e164)?.agencyId === c.agencyId : false;
        if (e164 && !official && !c.verifiedPhones.includes(e164)) {
          conflicts.push({ caseId: c.id, kind: "CONTACT_MISMATCH", detail: `Phone ${f.value} isn't one your case's earlier letters used` });
          break;
        }
      }
    }
  }
  return { c, score: s, refMatch, reasons, conflicts, programMatch };
}

export function threadLetter(input: ThreadingInput): ThreadingResult {
  const agency = input.x.agency.value;
  const scored = input.candidates
    .filter((c) => c.agencyId === agency)
    .map((c) => score(input, c))
    .filter((s) => s.score >= ASK_SCORE || s.refMatch)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];

  let decision: CaseMatch["decision"] = "NEW";
  if (best) {
    if (best.refMatch && best.score >= AUTO_LINK_SCORE && !best.conflicts.length && !input.registryContradictions) {
      decision = "AUTO_LINK";
    } else if (best.conflicts.length) {
      decision = "ASK_CONFLICT";
    } else {
      decision = "ASK";
    }
  }

  const match: CaseMatch = {
    decision,
    candidates: scored.slice(0, 3).map((s) => ({ caseId: s.c.id, title: s.c.title, score: s.score, reasons: s.reasons })),
    conflicts: best?.conflicts ?? [],
    linkedCaseId: decision === "AUTO_LINK" ? best.c.id : null,
  };
  return { match, items: caseItems(input, best) };
}

function caseItems(input: ThreadingInput, best: Scored | undefined): VerificationItem[] {
  const { x, letterRef, refUncertain } = input;
  const items: VerificationItem[] = [];
  const ref = x.identifiers.find((i) => i.value && letterRef && normalize(i.value).endsWith(letterRef.last4)) ?? null;
  const base = {
    evidenceType: "CASE_FILE" as const,
    sourceId: null,
    sourceUrl: null,
    verifiedOn: null,
    officialAlternative: null,
  };
  const highlight = (f: { box: VerificationItem["highlight"]["boxes"][number] | null; page: number; sourceText: string | null } | null, low = false) => ({
    boxes: f?.box ? [f.box] : [],
    page: f?.page ?? 1,
    quote: f?.sourceText ?? null,
    lowConfidence: low,
  });

  if (letterRef || refUncertain) {
    const refField = ref ?? x.identifiers.find((i) => i.value) ?? null;
    const shown = letterRef ? `…${letterRef.last4}` : `…${normalize(refField?.value ?? "").slice(-4)}`;
    const conflict = best?.conflicts.find((c) => c.kind === "REFERENCE_MISMATCH");
    if (refUncertain) {
      items.push({
        ...base,
        id: "reference-case",
        claimType: "reference",
        letterValue: shown,
        status: "NEEDS_USER_CONFIRMATION",
        strength: "NONE",
        reason: "Part of the reference number is unclear. Please type it from your letter so we can compare it with your cases.",
        highlight: highlight(refField, true),
      });
    } else if (best?.refMatch) {
      items.push({
        ...base,
        id: "reference-case",
        claimType: "reference",
        letterValue: shown,
        status: "VERIFIED_MATCH",
        strength: "STRONG",
        reason: `Matches the reference number of your existing case "${best.c.title}".`,
        highlight: highlight(refField),
      });
    } else if (conflict && best) {
      items.push({
        ...base,
        id: "reference-case",
        claimType: "reference",
        letterValue: shown,
        status: "VERIFIED_CONTRADICTION",
        // A different reference alone can be a separate, real matter. It only counts as a strong
        // contradiction when the registry also found problems with this letter.
        strength: input.registryContradictions ? "STRONG" : "SOFT",
        reason: `Doesn't match your existing case "${best.c.title}" (…${best.c.referenceLast4})${best.programMatch ? " for the same program" : ""}.${input.registryContradictions ? "" : " If this is a separate matter, keep it as a new case."}`,
        highlight: highlight(refField),
      });
    } else {
      items.push({
        ...base,
        id: "reference-case",
        claimType: "reference",
        letterValue: shown,
        status: "UNVERIFIED",
        strength: "NONE",
        reason: best
          ? "Your matching case has no reference number to compare with."
          : "This is a new reference number. There's no earlier case to compare it with yet.",
        highlight: highlight(refField),
      });
    }
  }

  const period = best?.conflicts.find((c) => c.kind === "PERIOD_MISMATCH");
  if (period && best) {
    items.push({
      ...base,
      id: "tax_year-case",
      claimType: "tax_year",
      letterValue: String(x.taxYear.value),
      status: "VERIFIED_CONTRADICTION",
      strength: "SOFT",
      reason: `Your existing case "${best.c.title}" is for ${best.c.period}.`,
      highlight: highlight(x.taxYear),
    });
  }
  return items;
}

function normalize(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
