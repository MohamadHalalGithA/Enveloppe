import { and, asc, count, desc, eq, inArray, isNull, lt, max, min, or } from "drizzle-orm";
import {
  CaseZ,
  type Case,
  type CivilDate,
  type LetterSummary,
  type SubmissionProof,
  type Task,
  type VerificationItem,
} from "@/lib/contracts";
import type { CaseCandidate } from "@/lib/cases/threading";
import { normalizePhone } from "@/lib/phone";
import { caseEvents, cases, letterImages, letters, tasks, users, verificationItems } from "./schema";
import type { Db } from "./types";

/**
 * Data access. Every function takes the authenticated user's id first and every query on private data
 * is scoped by it (CLAUDE.md: "case.id = requested AND case.user_id = authenticated"). A row that exists
 * but belongs to someone else is indistinguishable from a missing one.
 */

export type LetterRow = typeof letters.$inferSelect;
export type LetterUpdate = Partial<Omit<typeof letters.$inferInsert, "id" | "userId" | "imageSha256" | "createdAt">>;
export type CaseRow = typeof cases.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;

// ---------- users ----------

export async function upsertUserBySub(db: Db, auth0Sub: string): Promise<{ id: string }> {
  const [row] = await db
    .insert(users)
    .values({ auth0Sub })
    .onConflictDoUpdate({ target: users.auth0Sub, set: { auth0Sub } })
    .returning({ id: users.id });
  return row;
}

// ---------- letters ----------

/** Idempotent per (user, image hash): uploading the same image twice returns the existing letter. */
export async function createLetter(db: Db, userId: string, imageSha256: string): Promise<{ id: string; existing: boolean }> {
  const [inserted] = await db
    .insert(letters)
    .values({ userId, imageSha256, status: "UPLOADED" })
    .onConflictDoNothing({ target: [letters.userId, letters.imageSha256] })
    .returning({ id: letters.id });
  if (inserted) return { id: inserted.id, existing: false };
  const [row] = await db
    .select({ id: letters.id })
    .from(letters)
    .where(and(eq(letters.userId, userId), eq(letters.imageSha256, imageSha256)));
  return { id: row.id, existing: true };
}

export async function getLetterRow(db: Db, userId: string, letterId: string): Promise<LetterRow | null> {
  const [row] = await db.select().from(letters).where(and(eq(letters.id, letterId), eq(letters.userId, userId)));
  return row ?? null;
}

export async function updateLetter(db: Db, userId: string, letterId: string, set: LetterUpdate): Promise<void> {
  await db.update(letters).set(set).where(and(eq(letters.id, letterId), eq(letters.userId, userId)));
}

export async function replaceLetterItems(db: Db, userId: string, letterId: string, items: VerificationItem[]): Promise<void> {
  await db.delete(verificationItems).where(and(eq(verificationItems.letterId, letterId), eq(verificationItems.userId, userId)));
  if (!items.length) return;
  await db.insert(verificationItems).values(
    items.map((i, sort) => ({
      letterId,
      userId,
      claimType: i.claimType,
      letterValue: i.letterValue,
      status: i.status,
      strength: i.strength,
      evidenceType: i.evidenceType,
      reason: i.reason,
      sourceId: i.sourceId,
      sourceUrl: i.sourceUrl,
      verifiedOn: i.verifiedOn,
      officialAlternative: i.officialAlternative,
      highlight: i.highlight,
      sort,
    })),
  );
}

export async function getLetterItems(db: Db, userId: string, letterId: string): Promise<VerificationItem[]> {
  const rows = await db
    .select()
    .from(verificationItems)
    .where(and(eq(verificationItems.letterId, letterId), eq(verificationItems.userId, userId)))
    .orderBy(asc(verificationItems.sort));
  return rows.map((r) => ({
    id: r.id,
    claimType: r.claimType as VerificationItem["claimType"],
    letterValue: r.letterValue,
    status: r.status as VerificationItem["status"],
    strength: r.strength as VerificationItem["strength"],
    evidenceType: r.evidenceType as VerificationItem["evidenceType"],
    reason: r.reason,
    sourceId: r.sourceId,
    sourceUrl: r.sourceUrl,
    verifiedOn: r.verifiedOn,
    officialAlternative: r.officialAlternative as VerificationItem["officialAlternative"],
    highlight: r.highlight as VerificationItem["highlight"],
  }));
}

function toSummary(r: LetterRow): LetterSummary & { caseRole: "primary" | "suspected_imitation" | null } {
  return {
    id: r.id,
    caseId: r.caseId,
    title: r.title ?? "Letter",
    status: r.status as LetterSummary["status"],
    verdict: (r.verdict ?? "CANNOT_VERIFY") as LetterSummary["verdict"],
    createdAt: r.createdAt.toISOString(),
    caseRole: r.caseRole as "primary" | "suspected_imitation" | null,
  };
}

export async function listLetters(db: Db, userId: string, opts: { caseId?: string; limit?: number } = {}) {
  const where = opts.caseId
    ? and(eq(letters.userId, userId), eq(letters.caseId, opts.caseId))
    : eq(letters.userId, userId);
  const rows = await db.select().from(letters).where(where).orderBy(desc(letters.createdAt)).limit(opts.limit ?? 100);
  return rows.map(toSummary);
}

/** Stores the sanitized image; it expires (and is purged) after the retention period. */
export async function storeLetterImage(
  db: Db,
  userId: string,
  letterId: string,
  img: { bytes: Buffer; mime: string; width: number; height: number },
  deleteAfter: Date,
): Promise<void> {
  // Re-uploading the same photo restores an expired image and restarts its retention period.
  await db
    .insert(letterImages)
    .values({ letterId, userId, bytes: img.bytes, mime: img.mime, width: img.width, height: img.height, deleteAfter })
    .onConflictDoUpdate({
      target: letterImages.letterId,
      set: { bytes: img.bytes, mime: img.mime, width: img.width, height: img.height, deleteAfter },
      setWhere: eq(letterImages.userId, userId),
    });
}

/** Image bytes for the owner, or "expired" once past retention, or null if missing / not theirs. */
export async function getLetterImage(
  db: Db,
  userId: string,
  letterId: string,
  now: Date,
): Promise<{ bytes: Buffer; mime: string; width: number; height: number } | "expired" | null> {
  const [row] = await db
    .select()
    .from(letterImages)
    .where(and(eq(letterImages.letterId, letterId), eq(letterImages.userId, userId)));
  if (!row) return null;
  if (row.deleteAfter <= now) return "expired";
  return { bytes: Buffer.from(row.bytes), mime: row.mime, width: row.width, height: row.height };
}

export async function getLetterImageInfo(db: Db, userId: string, letterId: string, now: Date) {
  const [row] = await db
    .select({ width: letterImages.width, height: letterImages.height, deleteAfter: letterImages.deleteAfter })
    .from(letterImages)
    .where(and(eq(letterImages.letterId, letterId), eq(letterImages.userId, userId)));
  return row && row.deleteAfter > now ? { width: row.width, height: row.height } : null;
}

/** Retention: remove images past their delete_after (maintenance; not scoped to one user by design). */
export async function purgeExpiredImages(db: Db, now: Date): Promise<number> {
  const gone = await db.delete(letterImages).where(lt(letterImages.deleteAfter, now)).returning({ id: letterImages.letterId });
  return gone.length;
}

/**
 * Claims a letter for analysis. Succeeds from UPLOADED / FAILED / SERVICE_UNAVAILABLE, or from a PROCESSING
 * claim older than `staleBefore` (a crashed run). Returns false if another analysis holds it.
 */
export async function claimForAnalysis(db: Db, userId: string, letterId: string, now: Date, staleBefore: Date): Promise<boolean> {
  const claimed = await db
    .update(letters)
    .set({ status: "PROCESSING", analysisStartedAt: now, errorCode: null })
    .where(
      and(
        eq(letters.id, letterId),
        eq(letters.userId, userId),
        or(
          inArray(letters.status, ["UPLOADED", "FAILED", "SERVICE_UNAVAILABLE"]),
          and(eq(letters.status, "PROCESSING"), or(isNull(letters.analysisStartedAt), lt(letters.analysisStartedAt, staleBefore))),
        ),
      ),
    )
    .returning({ id: letters.id });
  return claimed.length > 0;
}

export async function markLetterFailed(db: Db, userId: string, letterId: string, status: "FAILED" | "SERVICE_UNAVAILABLE", errorCode: string) {
  await updateLetter(db, userId, letterId, { status, errorCode });
}

export async function deleteLetter(db: Db, userId: string, letterId: string): Promise<boolean> {
  const gone = await db
    .delete(letters)
    .where(and(eq(letters.id, letterId), eq(letters.userId, userId)))
    .returning({ id: letters.id });
  return gone.length > 0;
}

// ---------- cases ----------

export async function getCaseRow(db: Db, userId: string, caseId: string): Promise<CaseRow | null> {
  const [row] = await db.select().from(cases).where(and(eq(cases.id, caseId), eq(cases.userId, userId)));
  return row ?? null;
}

export async function createCase(
  db: Db,
  userId: string,
  v: Omit<typeof cases.$inferInsert, "id" | "userId" | "createdAt" | "updatedAt">,
): Promise<CaseRow> {
  const [row] = await db.insert(cases).values({ ...v, userId }).returning();
  return row;
}

export async function updateCase(db: Db, userId: string, caseId: string, set: { stageId?: string | null; status?: Case["status"] }) {
  await db
    .update(cases)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(cases.id, caseId), eq(cases.userId, userId)));
}

/** Deletes the case and the letters filed in it (images, ledger items and tasks cascade). */
export async function deleteCase(db: Db, userId: string, caseId: string): Promise<boolean> {
  await db.delete(letters).where(and(eq(letters.caseId, caseId), eq(letters.userId, userId)));
  const deleted = await db.delete(cases).where(and(eq(cases.id, caseId), eq(cases.userId, userId))).returning({ id: cases.id });
  return deleted.length > 0;
}

/** The user's cases for one agency, with what threading needs to compare a new letter against them. */
export async function caseCandidates(db: Db, userId: string, agencyId: string): Promise<CaseCandidate[]> {
  const rows = await db.select().from(cases).where(and(eq(cases.userId, userId), eq(cases.agencyId, agencyId)));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const latest = await db
    .select({ caseId: letters.caseId, latest: max(letters.issueDate) })
    .from(letters)
    .where(and(eq(letters.userId, userId), inArray(letters.caseId, ids), eq(letters.caseRole, "primary")))
    .groupBy(letters.caseId);
  const phones = await db
    .select({ caseId: letters.caseId, value: verificationItems.letterValue })
    .from(verificationItems)
    .innerJoin(letters, eq(letters.id, verificationItems.letterId))
    .where(
      and(
        eq(letters.userId, userId),
        eq(verificationItems.userId, userId),
        inArray(letters.caseId, ids),
        eq(letters.caseRole, "primary"),
        eq(verificationItems.claimType, "phone"),
        eq(verificationItems.status, "VERIFIED_MATCH"),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    agencyId: r.agencyId as CaseCandidate["agencyId"],
    processId: r.processId,
    stageId: r.stageId,
    program: r.program,
    period: r.period,
    referenceHmac: r.referenceHmac,
    referenceLast4: r.referenceLast4,
    createdOn: r.createdAt.toISOString().slice(0, 10),
    latestLetterDate: (latest.find((l) => l.caseId === r.id)?.latest as CivilDate | null) ?? null,
    verifiedPhones: [
      ...new Set(
        phones
          .filter((p) => p.caseId === r.id)
          .map((p) => normalizePhone(p.value).e164)
          .filter((e): e is string => !!e),
      ),
    ],
  }));
}

/** Client-facing cases (no user id, no reference HMAC), with next open deadline and letter count. */
export async function listCases(db: Db, userId: string, caseIds?: string[]): Promise<Case[]> {
  const where = caseIds ? and(eq(cases.userId, userId), inArray(cases.id, caseIds)) : eq(cases.userId, userId);
  const rows = await db.select().from(cases).where(where).orderBy(desc(cases.updatedAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const counts = await db
    .select({ caseId: letters.caseId, n: count() })
    .from(letters)
    .where(and(eq(letters.userId, userId), inArray(letters.caseId, ids)))
    .groupBy(letters.caseId);
  const due = await db
    .select({ caseId: tasks.caseId, next: min(tasks.dueDate) })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), inArray(tasks.caseId, ids), eq(tasks.status, "OPEN")))
    .groupBy(tasks.caseId);
  return rows.map((r) =>
    CaseZ.parse({
      id: r.id,
      agencyId: r.agencyId,
      processId: r.processId,
      stageId: r.stageId,
      title: r.title,
      program: r.program,
      period: r.period,
      referenceLast4: r.referenceLast4,
      status: r.status,
      nextDeadline: due.find((d) => d.caseId === r.id)?.next ?? null,
      letterCount: counts.find((c) => c.caseId === r.id)?.n ?? 0,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }),
  );
}

export async function addCaseEvent(
  db: Db,
  userId: string,
  caseId: string,
  type: "CASE_CREATED" | "LETTER_ADDED" | "LETTER_FLAGGED" | "STAGE_CHANGED" | "PROOF_SAVED" | "LINK_UNDONE",
  extra: { fromStage?: string | null; toStage?: string | null; letterId?: string | null } = {},
) {
  await db.insert(caseEvents).values({
    caseId,
    userId,
    type,
    fromStage: extra.fromStage ?? null,
    toStage: extra.toStage ?? null,
    letterId: extra.letterId ?? null,
  });
}

export async function listCaseEvents(db: Db, userId: string, caseId: string) {
  const rows = await db
    .select()
    .from(caseEvents)
    .where(and(eq(caseEvents.caseId, caseId), eq(caseEvents.userId, userId)))
    .orderBy(asc(caseEvents.id));
  return rows.map((e) => ({ type: e.type, fromStage: e.fromStage, toStage: e.toStage, createdAt: e.createdAt.toISOString() }));
}

// ---------- tasks ----------

export async function createTask(db: Db, userId: string, v: Omit<typeof tasks.$inferInsert, "id" | "userId" | "createdAt">) {
  const [row] = await db.insert(tasks).values({ ...v, userId }).returning();
  return row;
}

export async function getTaskRow(db: Db, userId: string, taskId: string): Promise<TaskRow | null> {
  const [row] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
  return row ?? null;
}

/** Only an OPEN task can be completed; returns null if it wasn't open (already done, or not the user's). */
export async function markTaskDone(db: Db, userId: string, taskId: string, proof: SubmissionProof): Promise<TaskRow | null> {
  const now = new Date();
  const [row] = await db
    .update(tasks)
    .set({
      status: "DONE",
      completedAt: now,
      proofConfirmation: proof.confirmationNumber,
      proofNotes: proof.notes,
      proofSubmittedAt: proof.submittedAt ? new Date(proof.submittedAt) : now,
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), eq(tasks.status, "OPEN")))
    .returning();
  return row ?? null;
}

/** The most recent task created from this letter, if any. */
export async function taskForLetter(db: Db, userId: string, letterId: string): Promise<TaskRow | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.letterId, letterId), eq(tasks.userId, userId)))
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  return row ?? null;
}

/** A newer letter replaced what these tasks asked for. */
export async function supersedeOpenTasks(db: Db, userId: string, caseId: string) {
  await db
    .update(tasks)
    .set({ status: "DONE", completedAt: new Date(), proofNotes: "Superseded by a newer letter" })
    .where(and(eq(tasks.caseId, caseId), eq(tasks.userId, userId), eq(tasks.status, "OPEN")));
}

export async function listTasks(db: Db, userId: string, caseId: string): Promise<Task[]> {
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.caseId, caseId), eq(tasks.userId, userId)))
    .orderBy(asc(tasks.createdAt));
  return rows.map((t) => ({
    id: t.id,
    caseId: t.caseId,
    letterId: t.letterId,
    title: t.title,
    actionType: t.actionType,
    dueDate: t.dueDate,
    status: t.status as Task["status"],
    checklist: (t.checklist as Task["checklist"] | null) ?? [],
    proof:
      t.status === "DONE" && t.proofSubmittedAt
        ? { confirmationNumber: t.proofConfirmation, notes: t.proofNotes, submittedAt: t.proofSubmittedAt.toISOString() }
        : null,
  }));
}

/** For tests and maintenance: count rows a user owns (never exposed through the API). */
export async function countOwned(db: Db, userId: string) {
  const [c] = await db.select({ n: count() }).from(cases).where(eq(cases.userId, userId));
  const [l] = await db.select({ n: count() }).from(letters).where(eq(letters.userId, userId));
  return { cases: c.n, letters: l.n };
}
