import { z } from "zod";
import { CaseMatchZ, CaseZ } from "./cases";
import { CivilDateZ } from "./common";
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
  /** Null only when the sender isn't an agency the Trust Registry covers. */
  officialContact: OfficialContactZ.nullable(),
  deadline: DeadlineResultZ,
  process: ProcessViewZ.nullable(),
  responsePack: ResponsePackZ.nullable(),
  caseMatch: CaseMatchZ,
  /** The case this letter is filed in, once linked or created (null while unfiled). */
  filedIn: z.object({ caseId: z.uuid(), title: z.string(), role: z.enum(["primary", "suspected_imitation"]) }).nullable().default(null),
  /** The user's answer to "same case?" (null = not answered yet). */
  caseDecision: z.enum(["LINKED", "NEW_CASE", "KEPT_SEPARATE"]).nullable().default(null),
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

export const TaskZ = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  letterId: z.uuid().nullable(),
  title: z.string(),
  actionType: z.string(),
  dueDate: CivilDateZ.nullable(),
  status: z.enum(["OPEN", "DONE"]),
  checklist: z.array(z.object({ label: z.string(), checked: z.boolean() })),
  proof: z
    .object({ confirmationNumber: z.string().nullable(), notes: z.string().nullable(), submittedAt: z.iso.datetime() })
    .nullable(),
});
export type Task = z.infer<typeof TaskZ>;

export const CaseDetailZ = z.object({
  case: CaseZ,
  process: ProcessViewZ.nullable(),
  letters: z.array(LetterSummaryZ.extend({ caseRole: z.enum(["primary", "suspected_imitation"]).nullable() })),
  tasks: z.array(TaskZ),
  events: z.array(
    z.object({ type: z.string(), fromStage: z.string().nullable(), toStage: z.string().nullable(), createdAt: z.iso.datetime() }),
  ),
});
export type CaseDetail = z.infer<typeof CaseDetailZ>;

/** What the user answers to "Is this the same case?" */
export const CaseDecisionZ = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("link"), caseId: z.uuid() }),
  z.object({ decision: z.literal("new") }),
  z.object({ decision: z.literal("keep_separate") }),
]);
export type CaseDecision = z.infer<typeof CaseDecisionZ>;

/** Proof the user saves after submitting on the official channel. Only these fields are accepted. */
export const SubmissionProofZ = z
  .object({
    confirmationNumber: z.string().trim().max(64).nullable().default(null),
    notes: z.string().trim().max(500).nullable().default(null),
    submittedAt: z.iso.datetime().optional(),
  })
  .strict();
export type SubmissionProof = z.infer<typeof SubmissionProofZ>;

/** GET /api/letters/:id: status always, the full result once analyzed. */
export const LetterEnvelopeZ = z.object({
  id: z.uuid(),
  status: LetterStatusZ,
  result: LetterResultZ.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type LetterEnvelope = z.infer<typeof LetterEnvelopeZ>;

/** POST /api/letters/:id/speech: the spoken explanation in one language, and its audio when available. */
export const SpeechResultZ = z.object({
  lang: z.string(),
  languageName: z.string(),
  dir: z.enum(["ltr", "rtl"]),
  /** Built from the verified result; never the letter's own text. */
  text: z.string(),
  machineTranslated: z.boolean(),
  audioUrl: z.string().nullable(),
  /** Why something is missing (no voice right now, translation fell back to English). */
  note: z.string().nullable(),
});
export type SpeechResult = z.infer<typeof SpeechResultZ>;

/** POST /api/letters response. */
export const UploadResultZ = z.object({ letterId: z.uuid(), status: LetterStatusZ, existing: z.boolean() });
export type UploadResult = z.infer<typeof UploadResultZ>;

export const ApiErrorZ = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorZ>;
