import type { CivilDate } from "@/lib/contracts";

/**
 * Civil-date arithmetic (no time zones: a deadline is a calendar day) and the holidays the federal
 * Interpretation Act s. 35 counts as holidays, plus Ontario's provincial ones (the Act includes days
 * a province designates). Computed per year, so there's no table to go stale.
 */

function toDate(d: CivilDate): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function fromDate(dt: Date): CivilDate {
  return dt.toISOString().slice(0, 10);
}

export function addDays(d: CivilDate, n: number): CivilDate {
  const dt = toDate(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromDate(dt);
}

/** Same month and day n years later; Feb 29 becomes Feb 28 in non-leap years. */
export function addYears(d: CivilDate, n: number): CivilDate {
  const [y, m, day] = d.split("-").map(Number);
  const target = new Date(Date.UTC(y + n, m - 1, 1));
  const lastDay = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromDate(target);
}

/** a − b in days. */
export function diffDays(a: CivilDate, b: CivilDate): number {
  return Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(d: CivilDate): number {
  return toDate(d).getUTCDay();
}

export const maxDate = (a: CivilDate, b: CivilDate) => (a > b ? a : b);
export const minDate = (a: CivilDate, b: CivilDate) => (a < b ? a : b);

function nthWeekday(year: number, month: number, weekday: number, n: number): CivilDate {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return fromDate(new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7)));
}

/** Anonymous Gregorian algorithm. */
function easterSunday(year: number): CivilDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return fromDate(new Date(Date.UTC(year, month - 1, day)));
}

export function holidaysFor(year: number): Map<CivilDate, string> {
  const easter = easterSunday(year);
  const may25 = `${year}-05-25`;
  const victoria = addDays(may25, -((dayOfWeek(may25) + 6) % 7 || 7)); // Monday before May 25
  const canadaDay = dayOfWeek(`${year}-07-01`) === 0 ? `${year}-07-02` : `${year}-07-01`;
  return new Map<CivilDate, string>([
    [`${year}-01-01`, "New Year's Day"],
    [nthWeekday(year, 2, 1, 3), "Family Day (Ontario)"],
    [addDays(easter, -2), "Good Friday"],
    [addDays(easter, 1), "Easter Monday"],
    [victoria, "Victoria Day"],
    [canadaDay, "Canada Day"],
    [nthWeekday(year, 9, 1, 1), "Labour Day"],
    [`${year}-09-30`, "National Day for Truth and Reconciliation"],
    [nthWeekday(year, 10, 1, 2), "Thanksgiving Day"],
    [`${year}-11-11`, "Remembrance Day"],
    [`${year}-12-25`, "Christmas Day"],
    [`${year}-12-26`, "Boxing Day (Ontario)"],
  ]);
}

/** Name of the holiday on this day (Sundays count, per s. 35), or null. */
export function holidayName(d: CivilDate): string | null {
  return holidaysFor(+d.slice(0, 4)).get(d) ?? (dayOfWeek(d) === 0 ? "a Sunday" : null);
}
