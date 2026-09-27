import type {
  CaseMatch,
  CivilDate,
  DeadlineResult,
  Extraction,
  LetterResult,
  LetterStatus,
  ProcessView,
  ResponsePack,
  Verdict,
  VerificationItem,
} from "@/lib/contracts";
import { computeDeadline, distrustDeadline } from "@/lib/deadlines/engine";
import { hasReadingUncertainty } from "@/lib/gemini/guard";
import { advanceForLetter, placeNewCase, processView } from "@/lib/processes/engine";
import type { Registry } from "@/lib/registry/load";
import { agencyEntry } from "@/lib/registry/lookup";
import { computeVerdict, sortItems } from "@/lib/verification";
import { usable } from "@/lib/deadlines/rules";
import { agencyLabel, caseTitle, DOC_LABEL, docTypeLabel, programTitle } from "./labels";
import type { RefDigest } from "./reference";
import { buildResponsePack } from "./response-pack";
import { threadLetter, type CaseCandidate } from "./threading";

/**
 * Pure assembly of a letter's Case File view: registry verification + the user's own cases →
 * case match, merged ledger, verdict, deadline, process position and Response Pack.
 * The database service decides what to persist; nothing here does I/O.
 */

export interface AssembleInput {
  x: Extraction;
  /** Registry-based items from lib/verification. */
  registryItems: VerificationItem[];
  registry: Registry;
  today: CivilDate;
  /** The user's cases (already scoped to the authenticated user). */
  candidates: CaseCandidate[];
  letterRef: RefDigest | null;
  refUncertain: boolean;
  answers?: Record<string, string>;
}

export interface CaseFileDraft {
  items: VerificationItem[];
  verdict: Verdict;
  caseMatch: CaseMatch;
  deadline: DeadlineResult;
  /** Where the letter sits: the linked case's advanced stage, or where a new case would start. */
  placement: { processId: string; stageId: string } | null;
  process: ProcessView | null;
  responsePack: ResponsePack | null;
  whatIsThis: LetterResult["whatIsThis"];
  needsConfirmation: LetterResult["needsConfirmation"];
  status: LetterStatus;
  /** Title for a new case opened from this letter. */
  newCaseTitle: string;
}

const HARD = (i: VerificationItem) => i.status === "VERIFIED_CONTRADICTION" && (i.strength === "HARD" || i.strength === "STRONG");

export function assembleCaseFile(input: AssembleInput): CaseFileDraft {
  const { x, registry: reg } = input;
  const agency = agencyEntry(reg, x.agency.value);

  const thread = threadLetter({
    x,
    registry: reg,
    candidates: input.candidates,
    letterRef: input.letterRef,
    refUncertain: input.refUncertain,
    registryContradictions: input.registryItems.some(HARD),
  });
  const items = sortItems([...input.registryItems, ...thread.items]);
  const verdict = computeVerdict(items, {
    agencyTracked: !!agency,
    fullyLegible: x.quality.legibility === "good" && !hasReadingUncertainty(x),
  });

  let deadline = computeDeadline(x, { today: input.today, registry: reg, answers: input.answers });
  if (verdict === "CONTRADICTIONS_FOUND") deadline = distrustDeadline(deadline, agency?.shortName ?? null);

  let placement: CaseFileDraft["placement"] = null;
  if (verdict !== "CONTRADICTIONS_FOUND") {
    const linked = input.candidates.find((c) => c.id === thread.match.linkedCaseId);
    if (linked?.processId) {
      const stageId = advanceForLetter(linked.processId, linked.stageId, x.documentType.value);
      placement = stageId ? { processId: linked.processId, stageId } : null;
    } else {
      placement = placeNewCase(x.documentType.value);
    }
  }

  const responsePack = buildResponsePack({ x, registry: reg, agency, verdict, items, deadline, placement });
  const needsConfirmation = confirmations(x);

  return {
    items,
    verdict,
    caseMatch: thread.match,
    deadline,
    placement,
    process: placement ? processView(reg, placement.processId, placement.stageId) : null,
    responsePack,
    whatIsThis: {
      agencyLabel: agencyLabel(x, agency, verdict),
      docTypeLabel: docTypeLabel(x),
      explanation: { en: explain(x, agencyLabel(x, agency, verdict), verdict, responsePack) },
    },
    needsConfirmation,
    status: letterStatus(x, needsConfirmation.length, !!agency),
    newCaseTitle: caseTitle(x, placeNewCase(x.documentType.value)?.processId ?? null, agency),
  };
}

function confirmations(x: Extraction): LetterResult["needsConfirmation"] {
  const out: LetterResult["needsConfirmation"] = [];
  const add = (path: string, label: string, f: { needsConfirmation: boolean; sourceText: string | null; value: unknown }) => {
    if (f.needsConfirmation) out.push({ path, label, value: f.sourceText ?? (f.value === null ? null : String(f.value)) });
  };
  add("issueDate", "Date printed on the letter", x.issueDate);
  x.printedDeadlines.forEach((d, i) => add(`printedDeadlines[${i}]`, "Deadline printed on the letter", d));
  x.identifiers.forEach((d, i) => add(`identifiers[${i}]`, "Reference number", d));
  add("taxYear", "Tax or benefit year", x.taxYear);
  x.phones.forEach((d, i) => add(`phones[${i}]`, "Phone number", d));
  x.urls.forEach((d, i) => add(`urls[${i}]`, "Website", d));
  return out;
}

function letterStatus(x: Extraction, pending: number, agencyTracked: boolean): LetterStatus {
  if (x.quality.legibility === "poor" || (x.quality.legibility === "partial" && pending > 0)) return "LOW_CONFIDENCE";
  if (pending > 0) return "NEEDS_CONFIRMATION";
  if (!agencyTracked) return "VERIFICATION_INCOMPLETE";
  return "SUCCESS";
}

/** Deterministic plain-language explanation (a translated version is generated later from this, never from the letter). */
function explain(x: Extraction, agency: string, verdict: Verdict, pack: ResponsePack | null): string {
  const summary = pack?.summary ?? "";
  if (verdict === "CONTRADICTIONS_FOUND") {
    return `This letter ${lowerFirst(agency)}. Several details contradict trusted information. ${summary}`.trim();
  }
  const doc = DOC_LABEL[x.documentType.value ?? "OTHER"].toLowerCase();
  const program = programTitle(usable(x.program));
  const year = usable(x.taxYear);
  const isNotice = x.documentType.value === "CRA_NOTICE_OF_ASSESSMENT" || x.documentType.value === "CRA_NOTICE_OF_REASSESSMENT";
  // Program names are proper nouns ("Canada Child Benefit"): keep their case.
  const about = isNotice ? (year ? ` for your ${year} tax year` : "") : program ? ` about the ${program}` : "";
  return `This is a ${doc}${about}, from the ${agency}. ${summary}`.trim();
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
