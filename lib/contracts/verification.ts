import { z } from "zod";
import { BoxZ, CivilDateZ, RegistryIdZ } from "./common";

/** Blueprint Part 8. Produced only by deterministic code, never by the model. */

export const VStatusZ = z.enum([
  "VERIFIED_MATCH",
  "VERIFIED_CONTRADICTION",
  "UNVERIFIED",
  "NEEDS_USER_CONFIRMATION",
]);
export type VStatus = z.infer<typeof VStatusZ>;

export const VStrengthZ = z.enum(["HARD", "STRONG", "SOFT", "NONE"]);
export type VStrength = z.infer<typeof VStrengthZ>;

export const ClaimTypeZ = z.enum([
  "agency",
  "phone",
  "url",
  "email",
  "qr",
  "payment",
  "reference",
  "tax_year",
  "form",
  "risk_language",
  "embedded_instruction",
]);
export type ClaimType = z.infer<typeof ClaimTypeZ>;

export const EvidenceTypeZ = z.enum(["TRUST_REGISTRY", "CASE_FILE", "DOMAIN_ANALYSIS", "RDAP", "NONE"]);
export type EvidenceType = z.infer<typeof EvidenceTypeZ>;

export const HighlightZ = z.object({
  /** All occurrences on the page; empty when the model gave no usable box. */
  boxes: z.array(BoxZ),
  page: z.number().int().min(1),
  /** Verbatim quote. Always shown as a fallback when boxes are missing or low confidence. */
  quote: z.string().max(500).nullable(),
  lowConfidence: z.boolean(),
});
export type Highlight = z.infer<typeof HighlightZ>;

export const VerificationItemZ = z.object({
  id: z.string().min(1),
  claimType: ClaimTypeZ,
  /** Display-safe. Identifiers are masked ("…4471"). */
  letterValue: z.string().max(300),
  status: VStatusZ,
  strength: VStrengthZ,
  evidenceType: EvidenceTypeZ,
  /** Plain-language, from deterministic templates. */
  reason: z.string().max(500),
  sourceId: RegistryIdZ.nullable(),
  sourceUrl: z.url().nullable(),
  verifiedOn: CivilDateZ.nullable(),
  /** Official value to use instead of the letter's value. Always from the registry. */
  officialAlternative: z
    .object({ label: z.string(), value: z.string(), registryId: RegistryIdZ })
    .nullable(),
  highlight: HighlightZ,
});
export type VerificationItem = z.infer<typeof VerificationItemZ>;

/** Four tiers, no score. Never "legitimate" / "scam". */
export const VerdictZ = z.enum([
  "CONSISTENT_WITH_TRUSTED_SOURCES",
  "PARTIALLY_VERIFIED",
  "CONTRADICTIONS_FOUND",
  "CANNOT_VERIFY",
]);
export type Verdict = z.infer<typeof VerdictZ>;
