import { z } from "zod";
import { AgencyCodeZ, CivilDateZ, DocTypeZ, PaymentMethodZ, RegistryIdZ } from "./common";

/**
 * Blueprint Part 7. Curated JSON in data/registry/*.json, validated at load.
 * `verifiedOn` is the date someone checked the value against the source page; `checkMethod` says how.
 * Never auto-filled.
 */

export const TrustedSourceZ = z.object({
  id: RegistryIdZ,
  title: z.string(),
  url: z.url(),
  publisher: z.string(),
  verifiedOn: CivilDateZ,
  verifiedBy: z.string().min(1),
  /** How the value was confirmed against the page. SEARCH_INDEX entries still need a human to open the page. */
  checkMethod: z.enum(["MANUAL", "FETCHED_PAGE", "SEARCH_INDEX"]),
  /** The page's own "Date modified", when it shows one. */
  pageModified: CivilDateZ.nullable(),
});
export type TrustedSource = z.infer<typeof TrustedSourceZ>;

const BaseZ = z.object({
  id: RegistryIdZ,
  agencyId: AgencyCodeZ,
  sourceId: RegistryIdZ,
  verifiedOn: CivilDateZ,
  evidenceType: z.enum(["OFFICIAL_PAGE", "OFFICIAL_DIRECTORY", "LEGISLATION", "TEAM_CURATED_ALLOWLIST"]),
  notes: z.string().optional(),
});

export const AgencyEntryZ = z.object({
  id: RegistryIdZ,
  code: AgencyCodeZ,
  name: z.string(),
  shortName: z.string(),
  homepage: z.url(),
  /** Contact used when no topic-specific contact matches. */
  defaultContactId: RegistryIdZ,
  sourceId: RegistryIdZ,
  verifiedOn: CivilDateZ,
});

export const OfficialDomainZ = BaseZ.extend({
  domain: z.string().regex(/^[a-z0-9.-]+$/),
  matchSubdomains: z.boolean(),
  role: z.enum(["GOVERNMENT", "AUTHORIZED_THIRD_PARTY"]),
  /** Shown to the user: "canada.ca is an official {ownerLabel} domain." */
  ownerLabel: z.string(),
  purpose: z.string().optional(),
});
export const ContactMethodZ = BaseZ.extend({
  kind: z.literal("phone"),
  e164: z.string().regex(/^\+?\d{3,15}$/),
  display: z.string(),
  label: z.string(),
  /** Lower-case keywords matched against the letter's program / document type to pick the best official contact. */
  topics: z.array(z.string()).default([]),
});
export const PaymentRuleZ = BaseZ.extend({
  method: PaymentMethodZ,
  verdict: z.enum(["ACCEPTED", "ACCEPTED_VIA_THIRD_PARTY", "NEVER_USED"]),
});
export const ScamRuleZ = BaseZ.extend({
  signal: z.enum([
    "demands_payment_method",
    "threatens_arrest_or_deportation",
    "threatens",
    "aggressive_language",
    "free_email_domain",
    "payment_by_phone",
  ]),
  /** Plain-language paraphrase of the official statement, shown to the user as the reason. */
  statement: z.string(),
  methods: z.array(PaymentMethodZ).optional(),
  keywords: z.array(z.string()).optional(),
  domains: z.array(z.string()).optional(),
});
export const GovernmentFormZ = BaseZ.extend({
  code: z.string(),
  name: z.string(),
  url: z.url(),
  usedFor: z.array(DocTypeZ),
});
export const SubmissionChannelZ = BaseZ.extend({
  name: z.string(),
  url: z.url(),
  forDocTypes: z.array(DocTypeZ),
  kind: z.enum(["portal", "mail", "in_person", "phone"]),
});

export type AgencyEntry = z.infer<typeof AgencyEntryZ>;
export type OfficialDomain = z.infer<typeof OfficialDomainZ>;
export type ContactMethod = z.infer<typeof ContactMethodZ>;
export type PaymentRule = z.infer<typeof PaymentRuleZ>;
export type ScamRule = z.infer<typeof ScamRuleZ>;
export type GovernmentForm = z.infer<typeof GovernmentFormZ>;
export type SubmissionChannel = z.infer<typeof SubmissionChannelZ>;
