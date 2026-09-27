import type { CivilDate, DeadlineResult, Extraction } from "@/lib/contracts";
import type { Registry } from "@/lib/registry/load";
import { sourceOf } from "@/lib/registry/lookup";
import { formatCivilDate } from "@/lib/ui/format";
import { addDays, dayOfWeek, diffDays, holidayName, minDate } from "./calendar";
import { objectionExtensionEnd, RULES, usable } from "./rules";

/**
 * Deadline Engine (Blueprint Part 12). Gemini extracted the dates; this code does every calculation.
 * Printed and rule-computed deadlines are kept separate; we act on the earlier one and never silently
 * shift a date for a weekend or holiday.
 */

const SOON_DAYS = 14;
const KIND_ORDER = ["respond_by", "pay_by", "appointment_by", "other"] as const;

function printedDeadline(x: Extraction): DeadlineResult["printed"] {
  const issued = usable(x.issueDate);
  const candidates = x.printedDeadlines
    .filter((d) => !d.needsConfirmation)
    .map((d) => ({
      d,
      date: d.value ?? (d.relativeDays !== null && issued ? addDays(issued, d.relativeDays) : null),
    }))
    .filter((c): c is typeof c & { date: CivilDate } => c.date !== null)
    .sort((a, b) => KIND_ORDER.indexOf(a.d.kind) - KIND_ORDER.indexOf(b.d.kind) || a.date.localeCompare(b.date));
  const best = candidates[0];
  return best ? { date: best.date, sourceText: best.d.sourceText ?? best.date, box: best.d.box } : null;
}

export function computeDeadline(
  x: Extraction,
  opts: { today: CivilDate; registry: Registry; answers?: Record<string, string> },
): DeadlineResult {
  const printed = printedDeadline(x);
  const rule = RULES.find((r) => r.appliesTo(x));
  const outcome = rule?.calculate(x, { today: opts.today, answers: opts.answers }) ?? null;
  const source = rule ? sourceOf(opts.registry, rule.sourceId) : null;
  const computed = outcome && source ? { ...outcome, sourceUrl: source.url, verifiedOn: source.verifiedOn } : null;

  const effective = printed && computed ? minDate(printed.date, computed.date) : (printed?.date ?? computed?.date ?? null);
  const daysRemaining = effective ? diffDays(effective, opts.today) : null;
  const status: DeadlineResult["status"] =
    daysRemaining === null ? "UNKNOWN" : daysRemaining < 0 ? "PASSED" : daysRemaining <= SOON_DAYS ? "SOON" : "OK";
  const clockStartedOn = usable(x.issueDate);

  const notes: string[] = [];
  if (computed && clockStartedOn) {
    notes.push("This deadline didn't start when you uploaded the letter. It started on the date printed on the notice.");
  }
  if (printed && !computed) {
    notes.push("This deadline is printed in the letter. We didn't find a legal rule that sets a different date.");
  }
  if (x.documentType.value === "CRA_REVIEW_DOCUMENT_REQUEST" && /benefit|credit/i.test(x.program.value ?? "")) {
    notes.push("CRA says that if you don't reply, your benefits may stop and you may have to repay amounts already paid. CRA can give you more time if you call before the deadline.");
  }
  if (rule && !outcome && x.issueDate.value && x.issueDate.needsConfirmation) {
    notes.push("We couldn't read the letter's date clearly. Confirm the date printed on your letter to calculate the deadline.");
  }
  if (effective) {
    const holiday = holidayName(effective);
    if (holiday && computed?.statutory && effective === computed.date) {
      notes.push(
        `${formatCivilDate(effective)} is ${holiday}. Under the Interpretation Act, a legal deadline that falls on a holiday moves to the next day that isn't one, but act before it to be safe.`,
      );
    } else if (holiday) {
      notes.push(`${formatCivilDate(effective)} is ${holiday}, when offices are closed. Act before it to be safe.`);
    } else if (dayOfWeek(effective) === 6) {
      notes.push(`${formatCivilDate(effective)} is a Saturday. Act before the weekend to be safe.`);
    }
  }
  if (status === "PASSED") {
    const lastDay = computed ? objectionExtensionEnd({ computed }) : null;
    notes.push(
      !lastDay
        ? "This date has passed. You may still have options: contact the agency using the official number."
        : lastDay >= opts.today
          ? `This deadline has passed. You can still ask CRA for an extension of time to object: apply as soon as possible, and no later than ${formatCivilDate(lastDay)}.`
          : `This deadline has passed, and so has the last day to ask CRA for an extension of time to object (${formatCivilDate(lastDay)}).`,
    );
  }
  if (!effective && !notes.length) notes.push("We didn't find a deadline in this letter.");

  return {
    asOf: opts.today,
    printed,
    computed,
    effective,
    mismatch: !!printed && !!computed && printed.date !== computed.date,
    daysRemaining,
    clockStartedOn,
    status,
    note: notes.join(" ") || null,
  };
}

/** A letter whose details contradict trusted sources shouldn't set anyone's deadline. */
export function distrustDeadline(d: DeadlineResult, agencyShortName: string | null): DeadlineResult {
  return {
    ...d,
    computed: null,
    effective: null,
    daysRemaining: null,
    mismatch: false,
    status: "UNKNOWN",
    note: `This date comes from a letter whose details contradict trusted sources. Don't act on it until you've checked with ${agencyShortName ?? "the agency"} directly.`,
  };
}
