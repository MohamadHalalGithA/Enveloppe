import { z } from "zod";
import { AgencyCodeZ, CivilDateZ } from "./common";

/** Blueprint Parts 10–11. */

export const CaseStatusZ = z.enum([
  "ACTION_REQUIRED",
  "SUBMITTED",
  "WAITING_FOR_GOVERNMENT",
  "NEEDS_REVIEW",
  "CLOSED",
]);
export type CaseStatus = z.infer<typeof CaseStatusZ>;

/**
 * Client-facing case. Deliberately has no userId and no reference HMAC:
 * those stay server-side (ownership comes from the session, never the client).
 */
export const CaseZ = z.object({
  id: z.uuid(),
  agencyId: AgencyCodeZ,
  processId: z.string().nullable(),
  stageId: z.string().nullable(),
  title: z.string().max(200),
  program: z.string().max(200).nullable(),
  period: z.string().max(20).nullable(),
  referenceLast4: z.string().max(4).nullable(),
  status: CaseStatusZ,
  nextDeadline: CivilDateZ.nullable(),
  letterCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Case = z.infer<typeof CaseZ>;

export const CaseMatchZ = z.object({
  decision: z.enum(["AUTO_LINK", "ASK", "ASK_CONFLICT", "NEW"]),
  candidates: z.array(
    z.object({
      caseId: z.uuid(),
      title: z.string(),
      score: z.number(),
      reasons: z.array(z.string()),
    }),
  ),
  conflicts: z.array(
    z.object({
      caseId: z.uuid(),
      kind: z.enum(["REFERENCE_MISMATCH", "PERIOD_MISMATCH", "CONTACT_MISMATCH"]),
      detail: z.string(),
    }),
  ),
  linkedCaseId: z.uuid().nullable(),
});
export type CaseMatch = z.infer<typeof CaseMatchZ>;
