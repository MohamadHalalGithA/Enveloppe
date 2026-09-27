import { z } from "zod";
import {
  CaseDecisionZ,
  type CivilDate,
  type LetterEnvelope,
  type UploadResult,
} from "@/lib/contracts";
import type { AppUser } from "@/lib/auth/resolve";
import { completeTask as completeTaskService, decideCase, getCaseDetail, getInbox, unlinkLetter } from "@/lib/cases/service";
import {
  createLetter,
  deleteCase,
  deleteLetter,
  getLetterImage,
  getLetterRow,
  getTaskRow,
  purgeExpiredImages,
  storeLetterImage,
} from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";
import { NotFoundError, PipelineError } from "@/lib/errors";
import type { ExtractResult } from "@/lib/gemini/extract";
import { analyzeLetter, confirmLetterFields, ConfirmFieldsZ, letterResultFor } from "@/lib/pipeline/analyze";
import { MAX_UPLOAD_BYTES, sanitizeUpload } from "@/lib/upload/sanitize";
import { assertSameOrigin, HttpError, json, parseId, readJson, withApi } from "./http";
import type { RateLimiter } from "./rate-limit";

/**
 * API route handlers (Blueprint Part 16). Every private handler:
 *   1. gets the user from the validated session (401 otherwise),
 *   2. for mutations, checks the request came from our own origin (403 otherwise),
 *   3. rate-limits expensive work per user (429),
 *   4. validates ids and bodies (404 / 400),
 *   5. runs the operation scoped to that user (someone else's id is a 404).
 * Dependencies are injected so tests exercise these exact handlers without Auth0 or Gemini.
 */

export interface ApiDeps {
  user: () => Promise<AppUser>;
  db: () => Promise<Db>;
  extract: (image: Buffer) => Promise<Pick<ExtractResult, "extraction" | "modelId">>;
  today: () => CivilDate;
  now: () => Date;
  refKey: () => string;
  appOrigin: string;
  limiter: RateLimiter;
  /** Uploaded images are deleted after this many days. */
  retentionDays: number;
}

const ANALYZED = new Set(["SUCCESS", "PARTIAL_SUCCESS", "NEEDS_CONFIRMATION", "LOW_CONFIDENCE", "VERIFICATION_INCOMPLETE"]);
const MULTIPART_OVERHEAD = 64 * 1024;

async function mutation(req: Request, deps: ApiDeps, bucket: "upload" | "analyze" | "mutate" = "mutate"): Promise<AppUser> {
  const user = await deps.user();
  assertSameOrigin(req, deps.appOrigin);
  deps.limiter.enforce(bucket, user.id);
  return user;
}

// ---------- letters ----------

export function uploadLetter(req: Request, deps: ApiDeps) {
  return withApi("POST /api/letters", async () => {
    const user = await mutation(req, deps, "upload");
    const length = Number(req.headers.get("content-length"));
    if (!Number.isFinite(length) || length <= 0) throw new HttpError(411, "LENGTH_REQUIRED", "Upload size unknown.");
    // Checked before reading the body: the proxy buffers at most 10 MB and would truncate silently beyond that.
    if (length > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) throw new PipelineError("IMAGE_TOO_LARGE");

    let file: FormDataEntryValue | null;
    try {
      file = (await req.formData()).get("file");
    } catch {
      throw new HttpError(400, "BAD_REQUEST", 'Send the photo as multipart/form-data in a field named "file".');
    }
    if (!(file instanceof File)) throw new HttpError(400, "BAD_REQUEST", 'Send the photo in a field named "file".');
    if (file.size > MAX_UPLOAD_BYTES) throw new PipelineError("IMAGE_TOO_LARGE");

    const img = await sanitizeUpload(Buffer.from(await file.arrayBuffer()));
    const db = await deps.db();
    const now = deps.now();
    await purgeExpiredImages(db, now); // retention, done opportunistically
    const { id, existing } = await createLetter(db, user.id, img.sha256);
    await storeLetterImage(db, user.id, id, img, new Date(now.getTime() + deps.retentionDays * 86_400_000));
    const row = await getLetterRow(db, user.id, id);
    const body: UploadResult = { letterId: id, status: row!.status as UploadResult["status"], existing };
    return json(body, existing ? 200 : 201);
  });
}

export function analyze(req: Request, id: string, deps: ApiDeps) {
  return withApi("POST /api/letters/:id/analyze", async () => {
    const user = await mutation(req, deps, "analyze");
    const result = await analyzeLetter(await deps.db(), user.id, parseId(id), {
      extract: deps.extract,
      today: deps.today,
      refKey: deps.refKey(),
      now: deps.now,
    });
    return json(result);
  });
}

export function getLetter(_req: Request, id: string, deps: ApiDeps) {
  return withApi("GET /api/letters/:id", async () => {
    const user = await deps.user();
    const db = await deps.db();
    const row = await getLetterRow(db, user.id, parseId(id));
    if (!row) throw new NotFoundError("Letter");
    const analyzed = ANALYZED.has(row.status);
    const body: LetterEnvelope = {
      id: row.id,
      status: row.status as LetterEnvelope["status"],
      result: analyzed ? await letterResultFor(db, user.id, row.id, deps.now()) : null,
      error: !analyzed && row.errorCode ? { code: row.errorCode, message: failureMessage(row.errorCode) } : null,
    };
    return json(body);
  });
}

function failureMessage(code: string): string {
  return code === "SERVICE_UNAVAILABLE"
    ? "The reading service was busy. Try analyzing again."
    : "We couldn't read this letter. Try a clearer, flatter photo.";
}

export function getImage(_req: Request, id: string, deps: ApiDeps) {
  return withApi("GET /api/letters/:id/image", async () => {
    const user = await deps.user();
    const img = await getLetterImage(await deps.db(), user.id, parseId(id), deps.now());
    if (!img) throw new NotFoundError("Image");
    if (img === "expired") throw new HttpError(410, "IMAGE_EXPIRED", "This image was deleted after the retention period.");
    return new Response(new Uint8Array(img.bytes), {
      headers: {
        "Content-Type": img.mime,
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

export function confirmFields(req: Request, id: string, deps: ApiDeps) {
  return withApi("POST /api/letters/:id/confirm", async () => {
    const user = await mutation(req, deps);
    const body = await readJson(req, ConfirmFieldsZ);
    const result = await confirmLetterFields(await deps.db(), user.id, parseId(id), body, {
      today: deps.today,
      refKey: deps.refKey(),
      now: deps.now,
    });
    return json(result);
  });
}

export function decide(req: Request, id: string, deps: ApiDeps) {
  return withApi("POST /api/letters/:id/case", async () => {
    const user = await mutation(req, deps);
    const decision = await readJson(req, CaseDecisionZ);
    const db = await deps.db();
    const letterId = parseId(id);
    await decideCase(db, user.id, letterId, decision);
    return json(await letterResultFor(db, user.id, letterId, deps.now()));
  });
}

export function unlink(req: Request, id: string, deps: ApiDeps) {
  return withApi("POST /api/letters/:id/unlink", async () => {
    const user = await mutation(req, deps);
    const db = await deps.db();
    const letterId = parseId(id);
    await unlinkLetter(db, user.id, letterId);
    return json(await letterResultFor(db, user.id, letterId, deps.now()));
  });
}

export function removeLetter(req: Request, id: string, deps: ApiDeps) {
  return withApi("DELETE /api/letters/:id", async () => {
    const user = await mutation(req, deps);
    if (!(await deleteLetter(await deps.db(), user.id, parseId(id)))) throw new NotFoundError("Letter");
    return new Response(null, { status: 204 });
  });
}

// ---------- cases & tasks ----------

export function inbox(_req: Request, deps: ApiDeps) {
  return withApi("GET /api/inbox", async () => {
    const user = await deps.user();
    return json(await getInbox(await deps.db(), user.id));
  });
}

export function caseDetail(_req: Request, id: string, deps: ApiDeps) {
  return withApi("GET /api/cases/:id", async () => {
    const user = await deps.user();
    return json(await getCaseDetail(await deps.db(), user.id, parseId(id)));
  });
}

export function removeCase(req: Request, id: string, deps: ApiDeps) {
  return withApi("DELETE /api/cases/:id", async () => {
    const user = await mutation(req, deps);
    if (!(await deleteCase(await deps.db(), user.id, parseId(id)))) throw new NotFoundError("Case");
    return new Response(null, { status: 204 });
  });
}

export function completeTask(req: Request, id: string, deps: ApiDeps) {
  return withApi("POST /api/tasks/:id/complete", async () => {
    const user = await mutation(req, deps);
    const proof = await readJson(req, z.unknown());
    const db = await deps.db();
    const taskId = parseId(id);
    const task = await getTaskRow(db, user.id, taskId);
    if (!task) throw new NotFoundError("Task");
    await completeTaskService(db, user.id, taskId, proof); // validates proof strictly (whitelisted fields)
    return json(await getCaseDetail(db, user.id, task.caseId));
  });
}
