import { z } from "zod";
import {
  AgencyEntryZ,
  ContactMethodZ,
  GovernmentFormZ,
  OfficialDomainZ,
  PaymentRuleZ,
  ScamRuleZ,
  SubmissionChannelZ,
  TrustedSourceZ,
  type AgencyEntry,
  type ContactMethod,
  type GovernmentForm,
  type OfficialDomain,
  type PaymentRule,
  type ScamRule,
  type SubmissionChannel,
  type TrustedSource,
} from "@/lib/contracts";
import agencies from "@/data/registry/agencies.json";
import channels from "@/data/registry/channels.json";
import contacts from "@/data/registry/contacts.json";
import domains from "@/data/registry/domains.json";
import forms from "@/data/registry/forms.json";
import payments from "@/data/registry/payments.json";
import scamRules from "@/data/registry/scam-rules.json";
import sources from "@/data/registry/sources.json";

/**
 * Trust Registry (Blueprint Part 7): curated, human-checked JSON under data/registry, validated here.
 * Read-only at runtime. A malformed or inconsistent registry is a build/test failure, never a silent default.
 */

export interface Registry {
  sources: Map<string, TrustedSource>;
  agencies: AgencyEntry[];
  contacts: ContactMethod[];
  domains: OfficialDomain[];
  payments: PaymentRule[];
  scamRules: ScamRule[];
  forms: GovernmentForm[];
  channels: SubmissionChannel[];
}

export interface RawRegistry {
  sources: unknown;
  agencies: unknown;
  contacts: unknown;
  domains: unknown;
  payments: unknown;
  scamRules: unknown;
  forms: unknown;
  channels: unknown;
}

export class RegistryError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid trust registry:\n- ${problems.join("\n- ")}`);
    this.name = "RegistryError";
  }
}

function parseList<T>(schema: z.ZodType<T>, raw: unknown, file: string, problems: string[]): T[] {
  const r = z.array(schema).safeParse(raw);
  if (r.success) return r.data;
  for (const i of r.error.issues) problems.push(`${file}[${i.path.join(".")}]: ${i.message}`);
  return [];
}

export function buildRegistry(raw: RawRegistry): Registry {
  const problems: string[] = [];
  const src = parseList(TrustedSourceZ, raw.sources, "sources", problems);
  const reg: Registry = {
    sources: new Map(src.map((s) => [s.id, s])),
    agencies: parseList(AgencyEntryZ, raw.agencies, "agencies", problems),
    contacts: parseList(ContactMethodZ, raw.contacts, "contacts", problems),
    domains: parseList(OfficialDomainZ, raw.domains, "domains", problems),
    payments: parseList(PaymentRuleZ, raw.payments, "payments", problems),
    scamRules: parseList(ScamRuleZ, raw.scamRules, "scam-rules", problems),
    forms: parseList(GovernmentFormZ, raw.forms, "forms", problems),
    channels: parseList(SubmissionChannelZ, raw.channels, "channels", problems),
  };

  // Unique ids across the whole registry.
  const seen = new Set<string>();
  const all = [
    ...src,
    ...reg.agencies,
    ...reg.contacts,
    ...reg.domains,
    ...reg.payments,
    ...reg.scamRules,
    ...reg.forms,
    ...reg.channels,
  ];
  for (const e of all) {
    if (seen.has(e.id)) problems.push(`duplicate id ${e.id}`);
    seen.add(e.id);
  }

  // Every entry cites a source that exists.
  for (const e of all) {
    if ("sourceId" in e && !reg.sources.has(e.sourceId)) problems.push(`${e.id} cites unknown source ${e.sourceId}`);
  }

  // Each agency's default contact exists and belongs to it.
  for (const a of reg.agencies) {
    const c = reg.contacts.find((x) => x.id === a.defaultContactId);
    if (!c) problems.push(`${a.id} default contact ${a.defaultContactId} not found`);
    else if (c.agencyId !== a.code) problems.push(`${a.id} default contact belongs to ${c.agencyId}`);
  }

  // No number or domain listed twice (two entries would make lookups ambiguous).
  const dup = <T>(items: T[], key: (t: T) => string, what: string) => {
    const s = new Set<string>();
    for (const i of items) {
      const k = key(i);
      if (s.has(k)) problems.push(`duplicate ${what} ${k}`);
      s.add(k);
    }
  };
  dup(reg.contacts, (c) => c.e164, "phone");
  dup(reg.domains, (d) => d.domain, "domain");
  dup(reg.payments, (p) => `${p.agencyId}:${p.method}`, "payment rule");

  // Sources must themselves be on an official government domain.
  const gov = reg.domains.filter((d) => d.role === "GOVERNMENT");
  for (const s of src) {
    const host = new URL(s.url).hostname;
    const ok = s.url.startsWith("https://") && gov.some((d) => host === d.domain || host.endsWith(`.${d.domain}`));
    if (!ok) problems.push(`source ${s.id} is not an https URL on an official government domain`);
  }

  if (problems.length) throw new RegistryError(problems);
  return reg;
}

let cached: Registry | null = null;

export function getRegistry(): Registry {
  cached ??= buildRegistry({ sources, agencies, contacts, domains, payments, scamRules, forms, channels });
  return cached;
}
