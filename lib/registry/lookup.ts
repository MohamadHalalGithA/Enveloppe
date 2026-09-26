import type {
  AgencyCode,
  AgencyEntry,
  ContactMethod,
  DocType,
  GovernmentForm,
  OfficialDomain,
  PaymentMethod,
  PaymentRule,
  ScamRule,
  SubmissionChannel,
  TrustedSource,
} from "@/lib/contracts";
import type { Registry } from "./load";

const FEDERAL = new Set<AgencyCode>(["CRA", "IRCC", "OTHER_GOVERNMENT"]);

export function sourceOf(reg: Registry, id: string): TrustedSource {
  const s = reg.sources.get(id);
  if (!s) throw new Error(`Unknown registry source ${id}`);
  return s;
}

export function agencyEntry(reg: Registry, code: AgencyCode | null): AgencyEntry | undefined {
  return code ? reg.agencies.find((a) => a.code === code) : undefined;
}

export function findContact(reg: Registry, e164: string): ContactMethod | undefined {
  return reg.contacts.find((c) => c.e164 === e164);
}

export function contactById(reg: Registry, id: string): ContactMethod | undefined {
  return reg.contacts.find((c) => c.id === id);
}

/** Exact domain or, when allowed, any subdomain of it. */
export function matchDomain(reg: Registry, host: string): OfficialDomain | undefined {
  return reg.domains.find((d) => host === d.domain || (d.matchSubdomains && host.endsWith(`.${d.domain}`)));
}

/** Government domains that are official for this agency (federal agencies share canada.ca / gc.ca). */
export function governmentDomainsFor(reg: Registry, agency: AgencyCode): OfficialDomain[] {
  return reg.domains.filter(
    (d) => d.role === "GOVERNMENT" && (d.agencyId === agency || (d.agencyId === "OTHER_GOVERNMENT" && FEDERAL.has(agency))),
  );
}

export function paymentRule(reg: Registry, agency: AgencyCode, method: PaymentMethod): PaymentRule | undefined {
  return reg.payments.find((p) => p.agencyId === agency && p.method === method);
}

export function scamRulesFor(reg: Registry, agency: AgencyCode, signal: ScamRule["signal"]): ScamRule[] {
  return reg.scamRules.filter(
    (r) => r.signal === signal && (r.agencyId === agency || (r.agencyId === "OTHER_GOVERNMENT" && FEDERAL.has(agency))),
  );
}

export function findForm(reg: Registry, agency: AgencyCode, code: string): GovernmentForm | undefined {
  const norm = (s: string) => s.toUpperCase().replace(/[\s-]/g, "");
  return reg.forms.find((f) => f.agencyId === agency && norm(f.code) === norm(code));
}

export function channelFor(reg: Registry, docType: DocType): SubmissionChannel | undefined {
  return reg.channels.find((c) => c.forDocTypes.includes(docType));
}

/**
 * The official number to show instead of anything printed in a letter. Picks the agency contact whose
 * topics best match the letter's program / document type; falls back to the agency default.
 */
export function officialContactFor(
  reg: Registry,
  agency: AgencyCode,
  hints: { program?: string | null; docType?: DocType | null; title?: string | null },
): ContactMethod | undefined {
  const entry = agencyEntry(reg, agency);
  if (!entry) return undefined;
  const text = [hints.program, hints.title, hints.docType?.toLowerCase().replaceAll("_", " ")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let best: { c: ContactMethod; score: number } | undefined;
  for (const c of reg.contacts.filter((x) => x.agencyId === agency)) {
    const score = c.topics.filter((t) => text.includes(t)).reduce((s, t) => s + t.length, 0);
    if (score > 0 && (!best || score > best.score)) best = { c, score };
  }
  return best?.c ?? contactById(reg, entry.defaultContactId);
}
