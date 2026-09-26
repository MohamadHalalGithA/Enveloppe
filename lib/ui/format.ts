import type { CivilDate, ClaimType, Verdict, VStatus } from "@/lib/contracts";

/** "2026-10-14" → "October 14, 2026". Formatted in UTC so a civil date never shifts a day. */
export function formatCivilDate(d: CivilDate | null | undefined, lang = "en-CA"): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, day)),
  );
}

export const VERDICT_COPY: Record<Verdict, { title: string; body: string; tone: Tone; icon: string }> = {
  CONSISTENT_WITH_TRUSTED_SOURCES: {
    title: "Matches trusted sources",
    body: "The details we could check match official government information.",
    tone: "good",
    icon: "✓",
  },
  PARTIALLY_VERIFIED: {
    title: "Partly verified",
    body: "Some details match official information. Others we couldn't check yet.",
    tone: "warn",
    icon: "!",
  },
  CONTRADICTIONS_FOUND: {
    title: "Contradictions found",
    body: "Several details contradict trusted information. Don't use the contact details in this letter.",
    tone: "bad",
    icon: "✗",
  },
  CANNOT_VERIFY: {
    title: "We can't check this yet",
    body: "We don't have trusted information for this sender. Contact the agency using an official channel.",
    tone: "neutral",
    icon: "?",
  },
};

export type Tone = "good" | "warn" | "bad" | "neutral";

export const TONE_CLASSES: Record<Tone, string> = {
  good: "border-emerald-700 bg-emerald-50 text-emerald-950",
  warn: "border-amber-600 bg-amber-50 text-amber-950",
  bad: "border-red-700 bg-red-50 text-red-950",
  neutral: "border-slate-400 bg-slate-50 text-slate-900",
};

export const STATUS_BADGE: Record<VStatus, { icon: string; label: string; tone: Tone }> = {
  VERIFIED_MATCH: { icon: "✓", label: "Matches", tone: "good" },
  VERIFIED_CONTRADICTION: { icon: "✗", label: "Contradicts", tone: "bad" },
  UNVERIFIED: { icon: "?", label: "Not verified", tone: "neutral" },
  NEEDS_USER_CONFIRMATION: { icon: "!", label: "Please confirm", tone: "warn" },
};

export const CLAIM_LABEL: Record<ClaimType, string> = {
  agency: "Agency",
  phone: "Phone number",
  url: "Website",
  email: "Email",
  qr: "QR code",
  payment: "Payment request",
  reference: "Reference number",
  tax_year: "Tax / benefit year",
  form: "Form",
  risk_language: "Pressure language",
  embedded_instruction: "Hidden instructions",
};
