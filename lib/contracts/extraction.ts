import { z } from "zod";
import { ActionTypeZ, AgencyCodeZ, BoxZ, CivilDateZ, DocTypeZ, PaymentMethodZ, type Box } from "./common";

/**
 * What Gemini returns (after the Contract Guard). Gemini is the reader, never the authority:
 * nothing here is a verdict. Every non-null value carries a verbatim `sourceText` quote.
 * Blueprint Part 6.
 */

export const ConfidenceZ = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceZ>;

export interface Field<T> {
  value: T | null;
  /** Verbatim quote from the letter (≤500 chars after guard). */
  sourceText: string | null;
  box: Box | null;
  /** 1-based page index. */
  page: number;
  confidence: Confidence;
  needsConfirmation: boolean;
}

const Str = z.string().max(500);

export function fieldZ<T extends z.ZodType>(value: T) {
  return z.object({
    value: value.nullable(),
    sourceText: Str.nullable(),
    box: BoxZ.nullable(),
    page: z.number().int().min(1),
    confidence: ConfidenceZ,
    needsConfirmation: z.boolean(),
  });
}

const ContextualStringFieldZ = fieldZ(Str).extend({ context: Str.nullable() });

export const ExtractionZ = z.object({
  schemaVersion: z.literal("1"),
  isGovernmentCorrespondence: z.enum(["yes", "no", "unclear"]),
  languages: z.array(z.enum(["en", "fr", "other"])),
  quality: z.object({
    legibility: z.enum(["good", "partial", "poor"]),
    issues: z.array(
      z.enum(["blur", "glare", "cropped", "rotated", "handwriting", "missing_pages", "low_resolution"]),
    ),
  }),
  agency: fieldZ(AgencyCodeZ).extend({ claimedName: Str.nullable() }),
  documentType: fieldZ(DocTypeZ).extend({ rawTitle: Str.nullable() }),
  issueDate: fieldZ(CivilDateZ),
  printedDeadlines: z.array(
    fieldZ(CivilDateZ).extend({
      kind: z.enum(["respond_by", "pay_by", "appointment_by", "other"]),
      relativeDays: z.number().int().min(0).max(3650).nullable(),
    }),
  ),
  identifiers: z.array(
    fieldZ(Str).extend({
      kind: z.enum([
        "case_number",
        "reference_number",
        "application_number",
        "client_id",
        "account_number",
        "other",
      ]),
    }),
  ),
  taxYear: fieldZ(z.number().int().min(1990).max(2100)),
  program: fieldZ(Str),
  phones: z.array(ContextualStringFieldZ),
  urls: z.array(ContextualStringFieldZ),
  emails: z.array(ContextualStringFieldZ),
  /** Location only. Decoding is our job (server-side jsQR), never the model's. */
  qrCodes: z.array(
    z.object({ box: BoxZ.nullable(), page: z.number().int().min(1), nearbyText: Str.nullable() }),
  ),
  paymentRequests: z.array(
    fieldZ(Str).extend({
      method: PaymentMethodZ,
      amount: z.number().nonnegative().nullable(),
      urgencyHours: z.number().nonnegative().nullable(),
    }),
  ),
  requiredActions: z.array(fieldZ(Str).extend({ actionType: ActionTypeZ })),
  requestedDocuments: z.array(fieldZ(Str)),
  formNumbers: z.array(fieldZ(Str)),
  riskSignals: z.array(
    z.object({
      type: z.enum([
        "urgency",
        "threat_arrest_or_police",
        "secrecy",
        "asks_personal_info",
        "unusual_payment",
        "poor_formatting",
      ]),
      sourceText: Str,
      box: BoxZ.nullable(),
    }),
  ),
  /** Text addressed to software/AI inside the letter. Reported, never obeyed. */
  embeddedInstructions: z.array(z.object({ sourceText: Str, box: BoxZ.nullable() })),
  uncertainFields: z.array(z.string().max(100)),
});
export type Extraction = z.infer<typeof ExtractionZ>;
