import { z } from "zod";
import { CaseMatchZ, CaseZ } from "./cases";
import { DeadlineResultZ } from "./deadlines";
import { ProcessViewZ } from "./process";
import { OfficialContactZ, ResponsePackZ } from "./response-pack";
import { VerdictZ, VerificationItemZ } from "./verification";

/** Blueprint Parts 16, 24, 29. Shapes returned by the API and rendered by the UI. */

export const LetterStatusZ = z.enum([
  "UPLOADED",
  "PROCESSING",
  "SUCCESS",
  "PARTIAL_SUCCESS",
  "NEEDS_CONFIRMATION",
  "LOW_CONFIDENCE",
  "VERIFICATION_INCOMPLETE",
  "SERVICE_UNAVAILABLE",
  "FAILED",
]);
export type LetterStatus = z.infer<typeof LetterStatusZ>;

export const LetterResultZ = z.object({
  id: z.uuid(),
  status: LetterStatusZ,
  createdAt: z.iso.datetime(),
  /** True when the reading came from a stored fixture/cache. The UI must badge it. */
  cached: z.boolean(),
  image: z
    .object({ url: z.string(), width: z.number().int().positive(), height: z.number().int().positive() })
    .nullable(),
  whatIsThis: z.object({
    agencyLabel: z.string(),
    docTypeLabel: z.string(),
    /** lang code → plain-language explanation. */
    explanation: z.record(z.string(), z.string()),
  }),
  verdict: VerdictZ,
  items: z.array(VerificationItemZ),
  officialContact: OfficialContactZ,
  deadline: DeadlineResultZ,
  process: ProcessViewZ.nullable(),
  responsePack: ResponsePackZ.nullable(),
  caseMatch: CaseMatchZ,
  needsConfirmation: z.array(
    z.object({ path: z.string(), label: z.string(), value: z.string().nullable() }),
  ),
  degraded: z.array(z.enum(["EXPLANATION", "QR", "RDAP", "REDIRECTS", "VOICE"])),
});
export type LetterResult = z.infer<typeof LetterResultZ>;

/** Inbox row for a letter (unfiled or recent). */
export const LetterSummaryZ = z.object({
  id: z.uuid(),
  caseId: z.uuid().nullable(),
  title: z.string(),
  status: LetterStatusZ,
  verdict: VerdictZ,
  createdAt: z.iso.datetime(),
});
export type LetterSummary = z.infer<typeof LetterSummaryZ>;

export const InboxZ = z.object({ cases: z.array(CaseZ), letters: z.array(LetterSummaryZ) });
export type Inbox = z.infer<typeof InboxZ>;

export const ApiErrorZ = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorZ>;
