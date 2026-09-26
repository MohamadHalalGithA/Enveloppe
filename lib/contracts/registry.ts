import { z } from "zod";
import { AgencyCodeZ, CivilDateZ, DocTypeZ, PaymentMethodZ, RegistryIdZ } from "./common";

/**
 * Blueprint Part 7. Curated, human-verified JSON in data/registry/*.json, validated at boot.
 * `verifiedOn` means a team member checked the source on that date. Never auto-filled.
 */

export const TrustedSourceZ = z.object({
  id: RegistryIdZ,
  title: z.string(),
  url: z.url(),
  publisher: z.string(),
  verifiedOn: CivilDateZ,
  verifiedBy: z.string().min(1),
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

export const OfficialDomainZ = BaseZ.extend({
  domain: z.string().regex(/^[a-z0-9.-]+$/),
  matchSubdomains: z.boolean(),
  role: z.enum(["GOVERNMENT", "AUTHORIZED_THIRD_PARTY"]),
  purpose: z.string().optional(),
});
export const ContactMethodZ = BaseZ.extend({
  kind: z.literal("phone"),
  e164: z.string().regex(/^\+?\d{3,15}$/),
  display: z.string(),
  label: z.string(),
  audience: z.string().optional(),
});
export const PaymentRuleZ = BaseZ.extend({
  method: PaymentMethodZ,
  verdict: z.enum(["ACCEPTED", "ACCEPTED_VIA_THIRD_PARTY", "NEVER_USED"]),
});
export const ScamRuleZ = BaseZ.extend({ signal: z.string(), statement: z.string() });
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

export type OfficialDomain = z.infer<typeof OfficialDomainZ>;
export type ContactMethod = z.infer<typeof ContactMethodZ>;
export type PaymentRule = z.infer<typeof PaymentRuleZ>;
export type ScamRule = z.infer<typeof ScamRuleZ>;
export type GovernmentForm = z.infer<typeof GovernmentFormZ>;
export type SubmissionChannel = z.infer<typeof SubmissionChannelZ>;
