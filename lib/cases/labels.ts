import type { AgencyEntry, DocType, Extraction, ProcessId, Verdict } from "@/lib/contracts";
import { usable } from "@/lib/deadlines/rules";

export const DOC_LABEL: Record<DocType, string> = {
  CRA_REVIEW_DOCUMENT_REQUEST: "Request for documents",
  CRA_NOTICE_OF_ASSESSMENT: "Notice of assessment",
  CRA_NOTICE_OF_REASSESSMENT: "Notice of reassessment",
  CRA_BALANCE_DUE: "Payment demand",
  IRCC_BIOMETRICS_INSTRUCTION: "Biometric instruction letter",
  IRCC_ACKNOWLEDGEMENT_OF_RECEIPT: "Acknowledgement of receipt",
  IRCC_DOCUMENT_REQUEST: "Request for documents",
  SERVICEONTARIO_RENEWAL: "Renewal notice",
  CITY_PROPERTY_TAX: "Property tax bill",
  CITY_PARKING_TICKET: "Parking ticket",
  OTHER: "Letter",
};

/** "Canada child benefit (CCB)" → "Canada child benefit". */
export function programTitle(program: string | null): string | null {
  if (!program) return null;
  const t = program.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

/** Comparable form of a program name: case, acronyms in parentheses and filler words don't matter. */
export function normalizeProgram(program: string | null): string {
  return (program ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(the|overpayment|review|payments?|validation)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function programsMatch(a: string | null, b: string | null): boolean {
  const na = normalizeProgram(a);
  const nb = normalizeProgram(b);
  return !!na && !!nb && (na === nb || na.includes(nb) || nb.includes(na));
}

export function docTypeLabel(x: Extraction): string {
  const doc = x.documentType.value ?? "OTHER";
  const program = programTitle(usable(x.program));
  const year = usable(x.taxYear);
  if (doc === "CRA_NOTICE_OF_ASSESSMENT" || doc === "CRA_NOTICE_OF_REASSESSMENT") {
    return year ? `${DOC_LABEL[doc]}: ${year} tax year` : DOC_LABEL[doc];
  }
  return program ? `${DOC_LABEL[doc]}: ${program}` : DOC_LABEL[doc];
}

export function agencyLabel(x: Extraction, agency: AgencyEntry | undefined, verdict: Verdict): string {
  if (!agency) return x.agency.claimedName ?? "Unknown sender";
  const name = `${agency.name} (${agency.shortName})`;
  return verdict === "CONTRADICTIONS_FOUND" ? `Claims to be from the ${name}` : name;
}

export function caseTitle(x: Extraction, processId: ProcessId | null, agency: AgencyEntry | undefined): string {
  const who = agency?.shortName ?? x.agency.claimedName ?? "Letter";
  const year = usable(x.taxYear);
  switch (processId) {
    case "CRA_REVIEW":
      return `${who}: ${programTitle(usable(x.program)) ?? "Benefits"} review`;
    case "CRA_OBJECTION":
      return `${who}: ${year ?? ""} ${x.documentType.value === "CRA_NOTICE_OF_ASSESSMENT" ? "assessment" : "reassessment"}`.replace(/\s+/g, " ");
    case "IRCC_BIOMETRICS":
      return `${who}: biometrics request`;
    default:
      return `${who}: ${DOC_LABEL[x.documentType.value ?? "OTHER"].toLowerCase()}`;
  }
}
