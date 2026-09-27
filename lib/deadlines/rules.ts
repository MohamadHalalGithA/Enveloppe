import type { CivilDate, DeadlineRule, Extraction, Field, RuleOutcome } from "@/lib/contracts";
import { formatCivilDate } from "@/lib/ui/format";
import { addDays, addYears, maxDate } from "./calendar";

/**
 * Deadline rules (Blueprint Part 12). Code, not prompts. Each cites the registry source it implements;
 * the engine fills in the source URL and verification date from the registry.
 */

/** A field's value only if we're confident we read it. */
export function usable<T>(f: Field<T>): T | null {
  return f.value !== null && !f.needsConfirmation ? f.value : null;
}

type RuleSpec = Omit<DeadlineRule, "calculate"> & {
  calculate(x: Extraction, ctx: { today: CivilDate; answers?: Record<string, string> }): Omit<RuleOutcome, "sourceUrl" | "verifiedOn"> | null;
};

/**
 * CRA-OBJ-165-1 (P148): individuals may object until the LATER of one year after the filing deadline for
 * the return, or 90 days from the date of the notice. A naive "90 days" is wrong for recent tax years.
 */
export const craObjection: RuleSpec = {
  id: "CRA-OBJ-165-1",
  agencyId: "CRA",
  sourceId: "src-cra-p148",
  verifiedOn: "2026-09-26",
  statutory: true,
  explanation: "Objection deadline for individuals: the later of one year after the filing deadline, or 90 days after the notice.",
  appliesTo: (x) =>
    x.agency.value === "CRA" &&
    (x.documentType.value === "CRA_NOTICE_OF_ASSESSMENT" || x.documentType.value === "CRA_NOTICE_OF_REASSESSMENT"),
  calculate(x, ctx) {
    const issued = usable(x.issueDate);
    const year = usable(x.taxYear);
    if (!issued || !year) return null;
    // Filing deadline (CRA important dates): April 30, or June 15 if you or your spouse are self-employed.
    const ninety = addDays(issued, 90);
    const regular = addYears(`${year + 1}-04-30`, 1);
    const selfEmployed = addYears(`${year + 1}-06-15`, 1);
    const answer = ctx.answers?.selfEmployed;
    const oneYear = answer === "yes" ? selfEmployed : regular;
    const date = maxDate(ninety, oneYear);
    const sameEitherWay = maxDate(ninety, regular) === maxDate(ninety, selfEmployed);
    const assumptions = [
      "You're filing as an individual (not a corporation or trust).",
      answer === "yes"
        ? `You or your spouse were self-employed in ${year}, so the filing deadline was June 15, ${year + 1}.`
        : answer === "no"
          ? `Nobody in your household was self-employed in ${year}, so the filing deadline was April 30, ${year + 1}.`
          : `We assumed the usual April 30, ${year + 1} filing deadline.${sameEitherWay ? " The result is the same if you or your spouse were self-employed." : " If you or your spouse were self-employed, tell us: the deadline would be later."}`,
    ];
    return {
      date,
      ruleId: this.id,
      statutory: true,
      explanation: `For individuals, you can object until the later of 90 days after the date on the notice (${formatCivilDate(ninety)}) or one year after your ${year} filing deadline (${formatCivilDate(oneYear)}).`,
      assumptions,
    };
  },
};

/** IRCC-BIO-30: "You have 30 days from the time you get your BIL to give your biometrics." */
export const irccBiometrics: RuleSpec = {
  id: "IRCC-BIO-30",
  agencyId: "IRCC",
  sourceId: "src-ircc-biometrics-where",
  verifiedOn: "2026-09-26",
  statutory: false,
  explanation: "IRCC gives 30 days from the time you get the biometric instruction letter.",
  appliesTo: (x) => x.documentType.value === "IRCC_BIOMETRICS_INSTRUCTION",
  calculate(x) {
    const issued = usable(x.issueDate);
    if (!issued) return null;
    return {
      date: addDays(issued, 30),
      ruleId: this.id,
      statutory: false,
      explanation: "IRCC says you have 30 days from the time you get your biometric instruction letter to give your biometrics.",
      assumptions: [
        "Counted from the date printed on the letter, the earliest the 30 days could start. If you got the letter later, you may have a few more days.",
      ],
    };
  },
};

export const RULES: RuleSpec[] = [craObjection, irccBiometrics];
