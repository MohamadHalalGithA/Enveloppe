import { parsePhoneNumberFromString } from "libphonenumber-js";

export interface NormalizedPhone {
  /** E.164 for full numbers ("+18003871193"), digits for N11 short codes ("311"), null if unparseable. */
  e164: string | null;
  /** 555-0100 to 555-0199 in North America is reserved for fiction and never assigned to a service. */
  fictional: boolean;
  shortCode: boolean;
}

export function normalizePhone(raw: string): NormalizedPhone {
  const digits = raw.replace(/\D/g, "");
  if (/^[2-9]11$/.test(digits)) return { e164: digits, fictional: false, shortCode: true };

  const parsed = parsePhoneNumberFromString(raw, "CA");
  const e164 = parsed?.number ?? null;
  const national = e164?.startsWith("+1") ? e164.slice(2) : null;
  const fictional = !!national && national.length === 10 && national.slice(3, 6) === "555" && /^01\d\d$/.test(national.slice(6));
  return { e164, fictional, shortCode: false };
}
