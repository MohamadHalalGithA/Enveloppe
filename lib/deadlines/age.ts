import type { CivilDate, DeadlineResult } from "@/lib/contracts";
import { formatCivilDate } from "@/lib/ui/format";

/**
 * "Hey, this letter is old." Timing only: it never says whether a letter is genuine (the registry decides that).
 * Worked out from the stored deadline, so it's as of the day the letter was analyzed, like the rest of that card.
 */

/** Whole years from `from` to `to` (civil dates). */
export function wholeYears(from: CivilDate, to: CivilDate): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
}

export interface OldLetterNotice {
  title: string;
  body: string;
}

/**
 * Shown when the letter's deadline has passed, or when it's dated a year or more ago and has no deadline still
 * running. A dated letter with a deadline still ahead isn't old news, whatever its age.
 */
export function oldLetterNotice(d: DeadlineResult): OldLetterNotice | null {
  const years = d.clockStartedOn ? wholeYears(d.clockStartedOn, d.asOf) : 0;
  const passed = d.status === "PASSED" && d.effective ? d.effective : null;
  if (years >= 1 && (passed || !d.effective)) {
    const ago = years === 1 ? "over a year ago" : `${years} years ago`;
    return {
      title: "This letter is old",
      body:
        `It's dated ${formatCivilDate(d.clockStartedOn!)} (${ago})` +
        (passed ? `, and its deadline, ${formatCivilDate(passed)}, has passed.` : ".") +
        " If it only just reached you, that's unusual: check with the agency directly before you act on it.",
    };
  }
  if (passed) {
    return {
      title: "This letter's deadline has passed",
      body: `The deadline was ${formatCivilDate(passed)}. The steps below say what you can still do.`,
    };
  }
  return null;
}
