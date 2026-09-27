import {
  ExtractionZ,
  LetterSummaryZ,
  SubmissionProofZ,
  type CaseDecision,
  type CaseDetail,
  type CaseMatch,
  type CivilDate,
  type DeadlineResult,
  type Extraction,
  type Inbox,
  type LetterResult,
  type ResponsePack,
} from "@/lib/contracts";
import {
  addCaseEvent,
  caseCandidates,
  createCase,
  createTask,
  getCaseRow,
  getLetterRow,
  getTaskRow,
  listCaseEvents,
  listCases,
  listLetters,
  listTasks,
  markTaskDone,
  replaceLetterItems,
  supersedeOpenTasks,
  updateCase,
  updateLetter,
  type LetterRow,
} from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";
import { objectionExtensionEnd, usable } from "@/lib/deadlines/rules";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { advanceForLetter, afterSubmit, placeNewCase, processById, processView, statusForStage } from "@/lib/processes/engine";
import type { QrFinding } from "@/lib/qr/decode";
import { getRegistry, type Registry } from "@/lib/registry/load";
import { verifyExtraction } from "@/lib/verification";
import { assembleCaseFile, type CaseFileDraft } from "./assemble";
import { redactExtractionForStorage } from "./mask";
import { digestReference, pickReference, type RefDigest } from "./reference";

/**
 * Case Brain service: turns an analyzed letter into a tracked Case File in the database.
 * Every call is scoped to the authenticated user id; ids from the client are only ever looked up
 * together with that user id. Multi-step changes run in one transaction.
 */

export interface FileLetterInput {
  /** Guarded Extraction straight from lib/gemini (unmasked; masked before anything is stored). */
  extraction: Extraction;
  qr: QrFinding[];
  modelId?: string | null;
  /** Pipeline stages that failed without blocking the result (e.g. QR decoding). */
  degraded?: LetterResult["degraded"];
  /**
   * Use this reference digest instead of reading one from the extraction. Needed when re-running on a
   * stored (masked) extraction: a masked number must never be digested.
   */
  reference?: { digest: RefDigest | null; uncertain: boolean };
}

export interface FileLetterOptions {
  today: CivilDate;
  /** REF_HMAC_KEY */
  refKey: string;
  registry?: Registry;
  answers?: Record<string, string>;
}

export interface FiledLetter {
  letterId: string;
  caseId: string | null;
  draft: CaseFileDraft;
}

type Summary = Pick<CaseFileDraft, "whatIsThis" | "needsConfirmation" | "placement" | "newCaseTitle"> & {
  degraded?: LetterResult["degraded"];
};

export async function fileAnalyzedLetter(
  db: Db,
  userId: string,
  letterId: string,
  input: FileLetterInput,
  opts: FileLetterOptions,
): Promise<FiledLetter> {
  const registry = opts.registry ?? getRegistry();
  let letterRef: RefDigest | null;
  let refUncertain: boolean;
  if (input.reference) {
    letterRef = input.reference.digest;
    refUncertain = input.reference.uncertain;
  } else {
    const picked = pickReference(input.extraction);
    letterRef = picked && !picked.uncertain ? digestReference(picked.field.value!, opts.refKey) : null;
    refUncertain = !!picked?.uncertain;
  }
  const x = redactExtractionForStorage(input.extraction);
  const degraded = input.degraded ?? [];

  return db.transaction(async (tx) => {
    const letter = await getLetterRow(tx, userId, letterId);
    if (!letter) throw new NotFoundError("Letter");

    const registryItems = verifyExtraction(x, { qr: input.qr, registry }).items;
    const candidates = x.agency.value ? await caseCandidates(tx, userId, x.agency.value) : [];
    const draft = assembleCaseFile({
      x,
      registryItems,
      registry,
      today: opts.today,
      candidates,
      letterRef,
      refUncertain,
      answers: opts.answers,
    });

    await updateLetter(tx, userId, letterId, {
      status: degraded.length && draft.status === "SUCCESS" ? "PARTIAL_SUCCESS" : draft.status,
      verdict: draft.verdict,
      docType: x.documentType.value,
      issueDate: usable(x.issueDate),
      title: draft.whatIsThis.docTypeLabel,
      referenceHmac: letterRef?.hmac ?? null,
      referenceLast4: letterRef?.last4 ?? null,
      referenceUncertain: refUncertain,
      extraction: x,
      qrFindings: input.qr,
      caseMatch: draft.caseMatch,
      deadline: draft.deadline,
      responsePack: draft.responsePack,
      summary: {
        whatIsThis: draft.whatIsThis,
        needsConfirmation: draft.needsConfirmation,
        placement: draft.placement,
        newCaseTitle: draft.newCaseTitle,
        degraded,
      } satisfies Summary,
      modelId: input.modelId ?? null,
      errorCode: null,
      analyzedAt: new Date(),
    });
    await replaceLetterItems(tx, userId, letterId, draft.items);

    let caseId: string | null = null;
    if (draft.caseMatch.decision === "AUTO_LINK" && draft.caseMatch.linkedCaseId) {
      caseId = draft.caseMatch.linkedCaseId;
      await attachToCase(tx, userId, letterId, caseId, {
        role: "primary",
        docType: x.documentType.value,
        deadline: draft.deadline,
        pack: draft.responsePack,
      });
    }
    return { letterId, caseId, draft };
  });
}

interface AttachInfo {
  role: "primary" | "suspected_imitation";
  docType: Extraction["documentType"]["value"];
  deadline: DeadlineResult | null;
  pack: ResponsePack | null;
}

async function attachToCase(db: Db, userId: string, letterId: string, caseId: string, info: AttachInfo): Promise<void> {
  const c = await getCaseRow(db, userId, caseId);
  if (!c) throw new NotFoundError("Case");
  await updateLetter(db, userId, letterId, { caseId, caseRole: info.role, caseDecision: "LINKED" });
  await addCaseEvent(db, userId, caseId, "LETTER_ADDED", { letterId });

  if (info.role === "suspected_imitation") {
    // A letter that conflicts with the case never moves it forward; the case is flagged instead.
    await updateCase(db, userId, caseId, { status: "NEEDS_REVIEW" });
    await addCaseEvent(db, userId, caseId, "LETTER_FLAGGED", { letterId });
    return;
  }

  const stageId = advanceForLetter(c.processId, c.stageId, info.docType);
  if (stageId !== c.stageId) {
    await supersedeOpenTasks(db, userId, caseId);
    await updateCase(db, userId, caseId, { stageId, status: statusForStage(c.processId, stageId) });
    await addCaseEvent(db, userId, caseId, "STAGE_CHANGED", { fromStage: c.stageId, toStage: stageId, letterId });
  }
  await maybeCreateTask(db, userId, caseId, letterId, c.processId, stageId, info);
}

async function maybeCreateTask(
  db: Db,
  userId: string,
  caseId: string,
  letterId: string,
  processId: string | null,
  stageId: string | null,
  info: AttachInfo,
): Promise<void> {
  const stage = processById(processId)?.stages.find((s) => s.id === stageId);
  // "Call and ask" isn't something to submit: saving proof would move the case on as if you had acted.
  if (!stage?.userAction || !info.pack?.action || info.pack.action.type === "call") return;
  await supersedeOpenTasks(db, userId, caseId);
  await createTask(db, userId, {
    caseId,
    letterId,
    actionType: info.pack.action.type,
    title: info.pack.action.label,
    dueDate: taskDueDate(info.deadline),
    status: "OPEN",
    checklist: info.pack.requestedDocuments.map((d) => ({ label: d.label, checked: false })),
  });
}

/** The deadline; once it has passed, the last day to ask for more time if there is one, else no date. */
function taskDueDate(d: DeadlineResult | null): CivilDate | null {
  if (!d?.effective) return null;
  if (d.status !== "PASSED") return d.effective;
  const lastDay = objectionExtensionEnd(d);
  return lastDay && lastDay >= d.asOf ? lastDay : null;
}

function analyzedParts(letter: LetterRow) {
  if (!letter.extraction || !letter.summary) throw new ConflictError("NOT_ANALYZED", "This letter hasn't been analyzed yet");
  return {
    x: ExtractionZ.parse(letter.extraction),
    summary: letter.summary as Summary,
    caseMatch: letter.caseMatch as CaseMatch,
    deadline: letter.deadline as DeadlineResult | null,
    pack: letter.responsePack as ResponsePack | null,
  };
}

/** The user's answer to "Is this the same case?" */
export async function decideCase(
  db: Db,
  userId: string,
  letterId: string,
  decision: CaseDecision,
): Promise<{ letterId: string; caseId: string | null }> {
  return db.transaction(async (tx) => {
    const letter = await getLetterRow(tx, userId, letterId);
    if (!letter) throw new NotFoundError("Letter");
    if (letter.caseId) throw new ConflictError("ALREADY_FILED", "This letter is already in a case");
    const { x, summary, caseMatch, deadline, pack } = analyzedParts(letter);
    const contradicted = letter.verdict === "CONTRADICTIONS_FOUND";

    if (decision.decision === "keep_separate") {
      await updateLetter(tx, userId, letterId, { caseDecision: "KEPT_SEPARATE" });
      return { letterId, caseId: null };
    }

    if (decision.decision === "link") {
      const target = await getCaseRow(tx, userId, decision.caseId);
      if (!target) throw new NotFoundError("Case");
      const conflicts = caseMatch.conflicts.some((c) => c.caseId === target.id);
      await attachToCase(tx, userId, letterId, target.id, {
        role: contradicted || conflicts ? "suspected_imitation" : "primary",
        docType: x.documentType.value,
        deadline,
        pack,
      });
      await updateLetter(tx, userId, letterId, { caseMatch: { ...caseMatch, linkedCaseId: target.id } });
      return { letterId, caseId: target.id };
    }

    // decision === "new"
    const placement = summary.placement ?? placeNewCase(x.documentType.value);
    const created = await createCase(tx, userId, {
      agencyId: x.agency.value ?? "UNKNOWN",
      processId: contradicted ? null : (placement?.processId ?? null),
      stageId: contradicted ? null : (placement?.stageId ?? null),
      title: summary.newCaseTitle,
      program: usable(x.program),
      period: usable(x.taxYear)?.toString() ?? null,
      referenceHmac: letter.referenceHmac,
      referenceLast4: letter.referenceLast4,
      status: contradicted ? "NEEDS_REVIEW" : placement ? statusForStage(placement.processId, placement.stageId) : "ACTION_REQUIRED",
    });
    await addCaseEvent(tx, userId, created.id, "CASE_CREATED", { toStage: created.stageId, letterId });
    await updateLetter(tx, userId, letterId, {
      caseId: created.id,
      caseRole: contradicted ? "suspected_imitation" : "primary",
      caseDecision: "NEW_CASE",
      caseMatch: { ...caseMatch, linkedCaseId: created.id },
    });
    await addCaseEvent(tx, userId, created.id, "LETTER_ADDED", { letterId });
    if (!contradicted) {
      await maybeCreateTask(tx, userId, created.id, letterId, created.processId, created.stageId, {
        role: "primary",
        docType: x.documentType.value,
        deadline,
        pack,
      });
    }
    return { letterId, caseId: created.id };
  });
}

/** "I've submitted it": save proof, move the case to its after-submission stage (usually waiting for government). */
export async function completeTask(db: Db, userId: string, taskId: string, proofInput: unknown) {
  const proof = SubmissionProofZ.parse(proofInput); // only whitelisted fields; anything else is rejected
  return db.transaction(async (tx) => {
    const task = await getTaskRow(tx, userId, taskId);
    if (!task) throw new NotFoundError("Task");
    if (task.status === "DONE") throw new ConflictError("ALREADY_DONE", "This task is already done");
    const done = await markTaskDone(tx, userId, taskId, proof);
    if (!done) throw new ConflictError("ALREADY_DONE", "This task is already done");

    const c = await getCaseRow(tx, userId, task.caseId);
    if (!c) throw new NotFoundError("Case");
    const stageId = afterSubmit(c.processId, c.stageId);
    const moved = stageId !== c.stageId;
    const status = moved ? statusForStage(c.processId, stageId) : "WAITING_FOR_GOVERNMENT";
    await updateCase(tx, userId, c.id, { stageId, status });
    await addCaseEvent(tx, userId, c.id, "PROOF_SAVED", { letterId: task.letterId });
    if (moved) await addCaseEvent(tx, userId, c.id, "STAGE_CHANGED", { fromStage: c.stageId, toStage: stageId });
    return { taskId, caseId: c.id, stageId, status };
  });
}

/** Undo an automatic or manual link. The case keeps its stage (processes never move backwards). */
export async function unlinkLetter(db: Db, userId: string, letterId: string) {
  return db.transaction(async (tx) => {
    const letter = await getLetterRow(tx, userId, letterId);
    if (!letter) throw new NotFoundError("Letter");
    if (!letter.caseId) throw new ConflictError("NOT_FILED", "This letter isn't in a case");
    await updateLetter(tx, userId, letterId, { caseId: null, caseRole: null, caseDecision: null });
    await addCaseEvent(tx, userId, letter.caseId, "LINK_UNDONE", { letterId });
    return { letterId, caseId: letter.caseId };
  });
}

export async function getInbox(db: Db, userId: string): Promise<Inbox> {
  const [cases, letters] = await Promise.all([listCases(db, userId), listLetters(db, userId, { limit: 50 })]);
  return { cases, letters: letters.map((l) => LetterSummaryZ.parse(l)) }; // parse strips caseRole
}

export async function getCaseDetail(db: Db, userId: string, caseId: string, registry: Registry = getRegistry()): Promise<CaseDetail> {
  const [found] = await listCases(db, userId, [caseId]);
  if (!found) throw new NotFoundError("Case");
  const [letters, tasks, events] = await Promise.all([
    listLetters(db, userId, { caseId }),
    listTasks(db, userId, caseId),
    listCaseEvents(db, userId, caseId),
  ]);
  return { case: found, process: processView(registry, found.processId, found.stageId), letters, tasks, events };
}

export type { RefDigest };
