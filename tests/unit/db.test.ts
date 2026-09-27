import { beforeAll, describe, expect, it } from "vitest";
import { resolveUser } from "@/lib/auth/resolve";
import {
  completeTask,
  decideCase,
  fileAnalyzedLetter,
  getCaseDetail,
  getInbox,
  unlinkLetter,
} from "@/lib/cases/service";
import { openPglite } from "@/lib/db/client";
import { createLetter, getLetterItems, getLetterRow } from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";
import { AuthError, ConflictError, NotFoundError } from "@/lib/errors";
import type { QrFinding } from "@/lib/qr/decode";
import { letterA, letterB, noticeOfReassessment } from "../helpers/extractions";

const refKey = "test-hmac-key-".repeat(4);
const opts = { today: "2026-09-27", refKey };
const scamQr: QrFinding[] = [{ box: [700, 700, 851, 896], page: 1, nearbyText: "Scan", decoded: "https://cra-canada-verify.example/ccb?ref=8902" }];

let db: Db;
let amira: { id: string };
let other: { id: string };

beforeAll(async () => {
  db = await openPglite(); // real Postgres (WASM), in memory, migrations applied
  amira = await resolveUser(db, "auth0|amira-demo");
  other = await resolveUser(db, "auth0|someone-else");
}, 60_000);

describe("resolveUser (identity comes only from the validated session sub)", () => {
  it("fails closed without a subject", async () => {
    await expect(resolveUser(db, undefined)).rejects.toBeInstanceOf(AuthError);
    await expect(resolveUser(db, "")).rejects.toBeInstanceOf(AuthError);
    await expect(resolveUser(db, { sub: "x" })).rejects.toBeInstanceOf(AuthError);
  });

  it("maps the same sub to the same internal user", async () => {
    expect((await resolveUser(db, "auth0|amira-demo")).id).toBe(amira.id);
    expect(other.id).not.toBe(amira.id);
  });
});

describe("Case File lifecycle: the twin-letter demo", () => {
  let letterAId: string;
  let letterBId: string;
  let caseId: string;
  let taskId: string;

  it("files Sample A as a new matter and stores no full reference number", async () => {
    letterAId = (await createLetter(db, amira.id, "a".repeat(64))).id;
    const filed = await fileAnalyzedLetter(db, amira.id, letterAId, { extraction: letterA(), qr: [] }, opts);
    expect(filed.draft.caseMatch.decision).toBe("NEW");
    expect(filed.caseId).toBeNull();

    const row = (await getLetterRow(db, amira.id, letterAId))!;
    expect(row).toMatchObject({ verdict: "CONSISTENT_WITH_TRUSTED_SOURCES", referenceLast4: "4471", issueDate: "2026-09-14" });
    expect(row.referenceHmac).toMatch(/^[0-9a-f]{64}$/);
    const stored = JSON.stringify({ row, items: await getLetterItems(db, amira.id, letterAId) });
    expect(stored).not.toContain("5831");
  });

  it("creates the case when the user confirms, with a task due on the printed deadline", async () => {
    caseId = (await decideCase(db, amira.id, letterAId, { decision: "new" })).caseId!;
    const detail = await getCaseDetail(db, amira.id, caseId);
    expect(detail.case).toMatchObject({
      title: "CRA: Canada Child Benefit review",
      status: "ACTION_REQUIRED",
      stageId: "DOCUMENTS_REQUESTED",
      referenceLast4: "4471",
      nextDeadline: "2026-10-14",
      letterCount: 1,
    });
    expect(detail.process?.currentStageId).toBe("DOCUMENTS_REQUESTED");
    expect(detail.tasks).toHaveLength(1);
    expect(detail.tasks[0]).toMatchObject({ status: "OPEN", dueDate: "2026-10-14", actionType: "submit_documents" });
    expect(detail.tasks[0].checklist).toHaveLength(2);
    taskId = detail.tasks[0].id;
    await expect(decideCase(db, amira.id, letterAId, { decision: "new" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("catches Sample B in context: it conflicts with the case A just created", async () => {
    letterBId = (await createLetter(db, amira.id, "b".repeat(64))).id;
    const filed = await fileAnalyzedLetter(db, amira.id, letterBId, { extraction: letterB(), qr: scamQr }, opts);
    expect(filed.draft.verdict).toBe("CONTRADICTIONS_FOUND");
    expect(filed.draft.caseMatch).toMatchObject({ decision: "ASK_CONFLICT", candidates: [{ caseId }] });
    const items = await getLetterItems(db, amira.id, letterBId);
    expect(items.find((i) => i.claimType === "reference")).toMatchObject({ status: "VERIFIED_CONTRADICTION", evidenceType: "CASE_FILE" });
    expect(items.filter((i) => i.strength === "HARD").map((i) => i.claimType).sort()).toEqual(["payment", "phone", "qr"]);
  });

  it("keeps the scam letter out of the case when the user says so", async () => {
    await decideCase(db, amira.id, letterBId, { decision: "keep_separate" });
    expect((await getLetterRow(db, amira.id, letterBId))!).toMatchObject({ caseId: null, caseDecision: "KEPT_SEPARATE" });
    expect((await getCaseDetail(db, amira.id, caseId)).case.status).toBe("ACTION_REQUIRED");
  });

  it("saves proof of submission and moves the case to waiting for CRA", async () => {
    await expect(completeTask(db, amira.id, taskId, { confirmationNumber: "X1", isAdmin: true })).rejects.toThrow();
    const r = await completeTask(db, amira.id, taskId, { confirmationNumber: "CRA-CONF-77310", notes: "Uploaded lease + school letter" });
    expect(r).toMatchObject({ stageId: "UNDER_REVIEW", status: "WAITING_FOR_GOVERNMENT" });
    const detail = await getCaseDetail(db, amira.id, caseId);
    expect(detail.case).toMatchObject({ status: "WAITING_FOR_GOVERNMENT", stageId: "UNDER_REVIEW", nextDeadline: null });
    expect(detail.tasks[0]).toMatchObject({ status: "DONE", proof: { confirmationNumber: "CRA-CONF-77310" } });
    expect(detail.process?.stages.find((s) => s.state === "current")?.expectNext).toMatch(/45 days/);
    expect(detail.events.map((e) => e.type)).toEqual(["CASE_CREATED", "LETTER_ADDED", "PROOF_SAVED", "STAGE_CHANGED"]);
    await expect(completeTask(db, amira.id, taskId, {})).rejects.toMatchObject({ code: "ALREADY_DONE" });
  });

  it("links a later letter with the same reference automatically, and can undo it", async () => {
    const id = (await createLetter(db, amira.id, "c".repeat(64))).id;
    const filed = await fileAnalyzedLetter(db, amira.id, id, { extraction: letterA(), qr: [] }, opts);
    expect(filed.draft.caseMatch.decision).toBe("AUTO_LINK");
    expect(filed.caseId).toBe(caseId);
    expect((await getCaseDetail(db, amira.id, caseId)).case.letterCount).toBe(2);
    await unlinkLetter(db, amira.id, id);
    expect((await getLetterRow(db, amira.id, id))!.caseId).toBeNull();
    expect((await getCaseDetail(db, amira.id, caseId)).events.at(-1)?.type).toBe("LINK_UNDONE");
  });

  it("flags a conflicting letter linked into the case instead of advancing it", async () => {
    const id = (await createLetter(db, amira.id, "d".repeat(64))).id;
    await fileAnalyzedLetter(db, amira.id, id, { extraction: letterB(), qr: scamQr }, opts);
    await decideCase(db, amira.id, id, { decision: "link", caseId });
    expect((await getLetterRow(db, amira.id, id))!.caseRole).toBe("suspected_imitation");
    const detail = await getCaseDetail(db, amira.id, caseId);
    expect(detail.case).toMatchObject({ status: "NEEDS_REVIEW", stageId: "UNDER_REVIEW" });
  });

  it("de-duplicates the same image per user", async () => {
    expect(await createLetter(db, amira.id, "a".repeat(64))).toEqual({ id: letterAId, existing: true });
  });

  describe("authorization: another signed-in user can't see or change any of it", () => {
    it("gets 404 for every resource id they didn't create", async () => {
      await expect(getCaseDetail(db, other.id, caseId)).rejects.toBeInstanceOf(NotFoundError);
      await expect(decideCase(db, other.id, letterBId, { decision: "new" })).rejects.toBeInstanceOf(NotFoundError);
      await expect(completeTask(db, other.id, taskId, {})).rejects.toBeInstanceOf(NotFoundError);
      await expect(unlinkLetter(db, other.id, letterAId)).rejects.toBeInstanceOf(NotFoundError);
      await expect(fileAnalyzedLetter(db, other.id, letterAId, { extraction: letterA(), qr: [] }, opts)).rejects.toBeInstanceOf(NotFoundError);
      expect(await getLetterRow(db, other.id, letterAId)).toBeNull();
      expect(await getLetterItems(db, other.id, letterAId)).toEqual([]);
    });

    it("can't attach their own letter to someone else's case", async () => {
      const mine = (await createLetter(db, other.id, "e".repeat(64))).id;
      await fileAnalyzedLetter(db, other.id, mine, { extraction: letterA(), qr: [] }, opts);
      await expect(decideCase(db, other.id, mine, { decision: "link", caseId })).rejects.toBeInstanceOf(NotFoundError);
    });

    it("never matches their letters against someone else's cases", async () => {
      const mine = (await createLetter(db, other.id, "f".repeat(64))).id;
      const filed = await fileAnalyzedLetter(db, other.id, mine, { extraction: letterA(), qr: [] }, opts);
      expect(filed.draft.caseMatch.candidates.every((c) => c.caseId !== caseId)).toBe(true);
    });

    it("sees only their own inbox", async () => {
      const inbox = await getInbox(db, other.id);
      expect(inbox.cases).toEqual([]);
      expect(inbox.letters.every((l) => l.id !== letterAId && l.id !== letterBId)).toBe(true);
      expect((await getInbox(db, amira.id)).cases.map((c) => c.id)).toEqual([caseId]);
    });
  });
});

describe("old letters", () => {
  it("a missed objection deadline: the task is due on the last day to ask for more time, not the missed date", async () => {
    const user = await resolveUser(db, "auth0|old-letters");
    const id = (await createLetter(db, user.id, "f".repeat(64))).id;
    const x = noticeOfReassessment({ issueDate: "2026-05-01", taxYear: 2023 });
    await fileAnalyzedLetter(db, user.id, id, { extraction: x, qr: [] }, opts);
    const caseId = (await decideCase(db, user.id, id, { decision: "new" })).caseId!;
    const detail = await getCaseDetail(db, user.id, caseId);
    expect(detail.tasks).toHaveLength(1);
    expect(detail.tasks[0]).toMatchObject({
      status: "OPEN",
      dueDate: "2027-07-30",
      actionType: "file_objection",
      title: "Decide whether to ask for more time to object",
    });
    expect(detail.case.nextDeadline).toBe("2027-07-30");
  });
});
