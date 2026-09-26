import type { CivilDate } from "@/lib/contracts";

/** Today's civil date in America/Toronto ("YYYY-MM-DD"). */
export function todayInToronto(now: Date = new Date()): CivilDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
