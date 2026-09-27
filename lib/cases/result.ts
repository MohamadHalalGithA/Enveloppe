import {
  LetterResultZ,
  type CaseMatch,
  type DeadlineResult,
  type LetterResult,
  type ResponsePack,
} from "@/lib/contracts";
import { getCaseRow, getLetterItems, getLetterRow, taskForLetter } from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { processView } from "@/lib/processes/engine";
import { getRegistry, type Registry } from "@/lib/registry/load";
import type { CaseFileDraft } from "./assemble";

type Summary = Pick<CaseFileDraft, "whatIsThis" | "needsConfirmation" | "placement" | "newCaseTitle"> & {
  degraded?: LetterResult["degraded"];
};

/**
 * The analysis result for one of the user's letters, assembled from stored rows (no model calls).
 * Scoped to the user like every other read.
 */
export async function loadLetterResult(
  db: Db,
  userId: string,
  letterId: string,
  opts: { image?: LetterResult["image"]; cached?: boolean; registry?: Registry } = {},
): Promise<LetterResult> {
  const registry = opts.registry ?? getRegistry();
  const row = await getLetterRow(db, userId, letterId);
  if (!row) throw new NotFoundError("Letter");
  if (!row.summary || !row.caseMatch || !row.deadline) {
    throw new ConflictError("NOT_ANALYZED", "This letter hasn't been analyzed yet");
  }
  const summary = row.summary as Summary;
  const items = await getLetterItems(db, userId, letterId);

  // Where the letter sits now: its case's current stage once filed, else where it would start.
  const filedCase = row.caseId ? await getCaseRow(db, userId, row.caseId) : null;
  const process = filedCase
    ? row.caseRole === "primary"
      ? processView(registry, filedCase.processId, filedCase.stageId)
      : null
    : summary.placement
      ? processView(registry, summary.placement.processId, summary.placement.stageId)
      : null;

  // Proof of submission, once the user has saved it.
  let pack = row.responsePack as ResponsePack | null;
  const task = pack ? await taskForLetter(db, userId, letterId) : null;
  if (pack && task?.status === "DONE" && task.proofSubmittedAt) {
    pack = {
      ...pack,
      completion: {
        status: "DONE",
        taskId: task.id,
        proof: {
          confirmationNumber: task.proofConfirmation,
          submittedAt: task.proofSubmittedAt.toISOString(),
          notes: task.proofNotes,
        },
      },
    };
  } else if (pack) {
    // An open task can be completed from the letter; a superseded one can't.
    pack = { ...pack, completion: { status: "OPEN", taskId: task?.status === "OPEN" ? task.id : null, proof: null } };
  }

  return LetterResultZ.parse({
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    cached: opts.cached ?? false,
    image: opts.image ?? null,
    whatIsThis: summary.whatIsThis,
    verdict: row.verdict,
    items,
    officialContact: pack?.officialContact ?? null,
    deadline: row.deadline as DeadlineResult,
    process,
    responsePack: pack,
    caseMatch: row.caseMatch as CaseMatch,
    filedIn: filedCase ? { caseId: filedCase.id, title: filedCase.title, role: row.caseRole ?? "primary" } : null,
    caseDecision: row.caseDecision,
    needsConfirmation: summary.needsConfirmation,
    degraded: summary.degraded ?? [],
  });
}
