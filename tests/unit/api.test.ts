import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CaseDetailZ,
  InboxZ,
  LetterEnvelopeZ,
  LetterResultZ,
  UploadResultZ,
  type Extraction,
} from "@/lib/contracts";
import * as api from "@/lib/api/handlers";
import type { ApiDeps } from "@/lib/api/handlers";
import { RateLimiter } from "@/lib/api/rate-limit";
import { resolveUser, type AppUser } from "@/lib/auth/resolve";
import { openPglite } from "@/lib/db/client";
import type { Db } from "@/lib/db/types";
import { AuthError, PipelineError } from "@/lib/errors";
import { letterA, letterB } from "../helpers/extractions";

const ORIGIN = "http://localhost:3000";
const KEY = "api-test-hmac-key-".repeat(4);

let db: Db;
let amira: AppUser;
let other: AppUser;
let current: AppUser | null;
let reading: () => Promise<{ extraction: Extraction; modelId: string }>;
let clock = new Date("2026-09-27T15:00:00Z");

const extract = vi.fn(async () => reading());
const deps = (limiter = new RateLimiter()): ApiDeps => ({
  user: async () => {
    if (!current) throw new AuthError();
    return current;
  },
  db: async () => db,
  extract,
  today: () => "2026-09-27",
  now: () => clock,
  refKey: () => KEY,
  appOrigin: ORIGIN,
  limiter,
  retentionDays: 30,
});
let d: ApiDeps;

const imageA = () => readFile("demo/letters/out/A_cra_ccb_review.png");
const imageB = () => readFile("demo/letters/out/B_cra_twin_scam.png");

async function uploadReq(bytes: Buffer, opts: { origin?: string | null; name?: string; contentLength?: string | null } = {}) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], opts.name ?? "letter.png"));
  const encoded = new Response(form);
  const body = Buffer.from(await encoded.arrayBuffer());
  const headers: Record<string, string> = { "content-type": encoded.headers.get("content-type")! };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.contentLength !== null) headers["content-length"] = opts.contentLength ?? String(body.length);
  return new Request(`${ORIGIN}/api/letters`, { method: "POST", body, headers });
}

function jsonReq(path: string, body: unknown, method = "POST", origin: string | null = ORIGIN) {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) };
  if (origin) headers.origin = origin;
  return new Request(`${ORIGIN}${path}`, { method, body: method === "GET" ? undefined : text, headers });
}
const get = (path: string) => new Request(`${ORIGIN}${path}`);

async function upload(bytes: Buffer) {
  const res = await api.uploadLetter(await uploadReq(bytes), d);
  return { res, body: UploadResultZ.parse(await res.json()) };
}

beforeAll(async () => {
  db = await openPglite();
  amira = await resolveUser(db, "auth0|api-amira");
  other = await resolveUser(db, "auth0|api-other");
  current = amira;
  d = deps();
}, 60_000);

// Each test gets a fresh rate limiter (the limit itself is tested explicitly below).
beforeEach(() => {
  d = deps();
});

describe("POST /api/letters (upload)", () => {
  it("requires a signed-in user", async () => {
    current = null;
    const res = await api.uploadLetter(await uploadReq(await imageA()), d);
    current = amira;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
  });

  it("rejects cross-site requests (CSRF)", async () => {
    expect((await api.uploadLetter(await uploadReq(await imageA(), { origin: null }), d)).status).toBe(403);
    expect((await api.uploadLetter(await uploadReq(await imageA(), { origin: "https://evil.example" }), d)).status).toBe(403);
  });

  it("rejects non-images, oversized and unsized uploads", async () => {
    expect((await api.uploadLetter(await uploadReq(Buffer.from("%PDF-1.7 hello"), { name: "x.pdf" }), d)).status).toBe(415);
    expect((await api.uploadLetter(await uploadReq(Buffer.from("<script>alert(1)</script>"), { name: "x.png" }), d)).status).toBe(415);
    expect((await api.uploadLetter(await uploadReq(await imageA(), { contentLength: String(50 * 1024 * 1024) }), d)).status).toBe(413);
    expect((await api.uploadLetter(await uploadReq(await imageA(), { contentLength: null }), d)).status).toBe(411);
    const notMultipart = new Request(`${ORIGIN}/api/letters`, {
      method: "POST",
      body: "hello",
      headers: { origin: ORIGIN, "content-type": "text/plain", "content-length": "5" },
    });
    expect((await api.uploadLetter(notMultipart, d)).status).toBe(400);
  });

  it("stores a sanitized copy and de-duplicates the same photo", async () => {
    const first = await upload(await imageA());
    expect(first.res.status).toBe(201);
    expect(first.body).toMatchObject({ status: "UPLOADED", existing: false });
    const again = await upload(await imageA());
    expect(again.res.status).toBe(200);
    expect(again.body).toEqual({ ...first.body, existing: true });

    const img = await api.getImage(get(`/api/letters/${first.body.letterId}/image`), first.body.letterId, d);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(img.headers.get("cache-control")).toBe("private, no-store");
    const bytes = Buffer.from(await img.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("strips EXIF / GPS metadata from photos", async () => {
    const withExif = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#fff" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret-owner", ImageDescription: "home address" } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const { body } = await upload(withExif);
    const img = await api.getImage(get("/x"), body.letterId, d);
    const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
    expect(meta.exif).toBeUndefined();
  });
});

describe("the pipeline through the API: the twin-letter demo", () => {
  let letterAId: string;
  let letterBId: string;
  let caseId: string;

  it("analyzes Sample A: stored result with the image, and a second call doesn't re-read", async () => {
    letterAId = (await upload(await imageA())).body.letterId;
    reading = async () => ({ extraction: letterA(), modelId: "fake-reader" });
    extract.mockClear();
    const res = await api.analyze(jsonReq(`/api/letters/${letterAId}/analyze`, {}), letterAId, d);
    expect(res.status).toBe(200);
    const result = LetterResultZ.parse(await res.json());
    expect(result).toMatchObject({ status: "SUCCESS", verdict: "CONSISTENT_WITH_TRUSTED_SOURCES", caseMatch: { decision: "NEW" } });
    expect(result.image).toEqual({ url: `/api/letters/${letterAId}/image`, width: 1275, height: 1650 });
    expect(result.responsePack?.officialChannel?.registryId).toBe("chan-cra-submit-docs");

    await api.analyze(jsonReq(`/api/letters/${letterAId}/analyze`, {}), letterAId, d);
    expect(extract).toHaveBeenCalledTimes(1);

    const env = LetterEnvelopeZ.parse(await (await api.getLetter(get(`/api/letters/${letterAId}`), letterAId, d)).json());
    expect(env).toMatchObject({ status: "SUCCESS", error: null });
    expect(env.result?.verdict).toBe("CONSISTENT_WITH_TRUSTED_SOURCES");
  });

  it("creates the case when the user confirms", async () => {
    const res = await api.decide(jsonReq(`/api/letters/${letterAId}/case`, { decision: "new" }), letterAId, d);
    const result = LetterResultZ.parse(await res.json());
    expect(result.filedIn).toMatchObject({ title: "CRA: Canada Child Benefit review", role: "primary" });
    caseId = result.filedIn!.caseId;
  });

  it("catches Sample B against that case, and keeps it separate on request", async () => {
    letterBId = (await upload(await imageB())).body.letterId;
    reading = async () => ({ extraction: letterB(), modelId: "fake-reader" });
    const result = LetterResultZ.parse(await (await api.analyze(jsonReq(`/api/letters/${letterBId}/analyze`, {}), letterBId, d)).json());
    expect(result.verdict).toBe("CONTRADICTIONS_FOUND");
    expect(result.caseMatch).toMatchObject({ decision: "ASK_CONFLICT", candidates: [{ caseId }] });
    // The QR code was decoded server-side from the stored (sanitized) image.
    expect(result.items.find((i) => i.claimType === "qr")).toMatchObject({ letterValue: "cra-canada-verify.example", strength: "HARD" });
    const kept = LetterResultZ.parse(
      await (await api.decide(jsonReq(`/api/letters/${letterBId}/case`, { decision: "keep_separate" }), letterBId, d)).json(),
    );
    expect(kept.filedIn).toBeNull();
  });

  it("saves proof of submission and returns the updated case", async () => {
    const detail = CaseDetailZ.parse(await (await api.caseDetail(get(`/api/cases/${caseId}`), caseId, d)).json());
    const taskId = detail.tasks[0].id;
    const bad = await api.completeTask(jsonReq(`/api/tasks/${taskId}/complete`, { confirmationNumber: "X", userId: other.id }), taskId, d);
    expect(bad.status).toBe(400); // mass assignment: unknown fields are rejected
    const res = await api.completeTask(jsonReq(`/api/tasks/${taskId}/complete`, { confirmationNumber: "CRA-77310" }), taskId, d);
    const after = CaseDetailZ.parse(await res.json());
    expect(after.case).toMatchObject({ status: "WAITING_FOR_GOVERNMENT", stageId: "UNDER_REVIEW" });
    expect((await api.completeTask(jsonReq(`/api/tasks/${taskId}/complete`, {}), taskId, d)).status).toBe(409);
  });

  it("confirming unclear fields re-runs every check without calling the reader again", async () => {
    const blurry = letterA();
    blurry.identifiers[0] = { ...blurry.identifiers[0], confidence: "low", needsConfirmation: true };
    blurry.issueDate = { ...blurry.issueDate, needsConfirmation: true };
    blurry.quality = { legibility: "partial", issues: ["glare"] };
    const id = (await upload(await readFile("demo/letters/out/E_low_quality.jpg"))).body.letterId;
    reading = async () => ({ extraction: blurry, modelId: "fake-reader" });
    const first = LetterResultZ.parse(await (await api.analyze(jsonReq(`/api/letters/${id}/analyze`, {}), id, d)).json());
    expect(first.status).toBe("LOW_CONFIDENCE");
    expect(first.caseMatch.decision).toBe("ASK");

    extract.mockClear();
    expect((await api.confirmFields(jsonReq(`/api/letters/${id}/confirm`, { secret: 1 }), id, d)).status).toBe(400);
    const res = await api.confirmFields(
      jsonReq(`/api/letters/${id}/confirm`, { reference: "2026-CCB-5831-4471", issueDate: "2026-09-14" }),
      id,
      d,
    );
    const confirmed = LetterResultZ.parse(await res.json());
    expect(extract).not.toHaveBeenCalled();
    expect(confirmed.needsConfirmation).toEqual([]);
    expect(confirmed.caseMatch.decision).toBe("AUTO_LINK"); // the confirmed reference matches case A
    expect(confirmed.filedIn?.caseId).toBe(caseId);
    expect((await api.confirmFields(jsonReq(`/api/letters/${id}/confirm`, { taxYear: 2025 }), id, d)).status).toBe(409);
  });

  describe("another user", () => {
    it("gets 404 for every one of these ids", async () => {
      current = other;
      try {
        const expect404 = async (p: Promise<Response>) => expect((await p).status).toBe(404);
        await expect404(api.getLetter(get("/x"), letterAId, d));
        await expect404(api.getImage(get("/x"), letterAId, d));
        await expect404(api.analyze(jsonReq("/x", {}), letterBId, d));
        await expect404(api.decide(jsonReq("/x", { decision: "new" }), letterBId, d));
        await expect404(api.confirmFields(jsonReq("/x", { taxYear: 2025 }), letterBId, d));
        await expect404(api.unlink(jsonReq("/x", {}), letterAId, d));
        await expect404(api.removeLetter(jsonReq("/x", undefined, "DELETE"), letterAId, d));
        await expect404(api.caseDetail(get("/x"), caseId, d));
        await expect404(api.removeCase(jsonReq("/x", undefined, "DELETE"), caseId, d));
        const inbox = InboxZ.parse(await (await api.inbox(get("/api/inbox"), d)).json());
        expect(inbox).toEqual({ cases: [], letters: [] });
      } finally {
        current = amira;
      }
      // Amira's data is untouched.
      expect((await api.getLetter(get("/x"), letterAId, d)).status).toBe(200);
    });

    it("treats malformed ids as not found", async () => {
      expect((await api.getLetter(get("/x"), "../../etc/passwd", d)).status).toBe(404);
      expect((await api.caseDetail(get("/x"), "1 OR 1=1", d)).status).toBe(404);
    });
  });

  it("deletes a letter (and its image) and a case with its letters", async () => {
    expect((await api.removeLetter(jsonReq("/x", undefined, "DELETE"), letterBId, d)).status).toBe(204);
    expect((await api.getLetter(get("/x"), letterBId, d)).status).toBe(404);
    expect((await api.getImage(get("/x"), letterBId, d)).status).toBe(404);
    expect((await api.removeCase(jsonReq("/x", undefined, "DELETE"), caseId, d)).status).toBe(204);
    expect((await api.getLetter(get("/x"), letterAId, d)).status).toBe(404);
  });
});

describe("failures and limits", () => {
  it("a reader outage is a 503, the letter is kept, and a retry succeeds", async () => {
    const id = (await upload(await imageB())).body.letterId;
    reading = async () => {
      throw new PipelineError("SERVICE_UNAVAILABLE");
    };
    const res = await api.analyze(jsonReq(`/api/letters/${id}/analyze`, {}), id, d);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("SERVICE_UNAVAILABLE");
    const env = LetterEnvelopeZ.parse(await (await api.getLetter(get("/x"), id, d)).json());
    expect(env).toMatchObject({ status: "SERVICE_UNAVAILABLE", result: null, error: { code: "SERVICE_UNAVAILABLE" } });

    reading = async () => ({ extraction: letterB(), modelId: "fake-reader" });
    expect((await api.analyze(jsonReq(`/api/letters/${id}/analyze`, {}), id, d)).status).toBe(200);
  });

  it("rate-limits analysis per user", async () => {
    const limited = deps(new RateLimiter(() => clock.getTime()));
    const id = (await upload(await imageA())).body.letterId;
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await api.analyze(jsonReq(`/api/letters/${id}/analyze`, {}), id, limited)).status);
    expect(statuses.slice(0, 6).every((s) => s !== 429)).toBe(true);
    const res = await api.analyze(jsonReq(`/api/letters/${id}/analyze`, {}), id, limited);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("rejects oversized and malformed JSON bodies", async () => {
    const id = (await upload(await imageA())).body.letterId;
    const big = jsonReq(`/api/letters/${id}/case`, { decision: "new", pad: "x".repeat(20_000) });
    expect((await api.decide(big, id, d)).status).toBe(413);
    const broken = new Request(`${ORIGIN}/api/letters/${id}/case`, {
      method: "POST",
      body: "{not json",
      headers: { origin: ORIGIN, "content-type": "application/json", "content-length": "9" },
    });
    expect((await api.decide(broken, id, d)).status).toBe(400);
  });

  it("expires images after the retention period", async () => {
    const id = (await upload(await imageA())).body.letterId;
    reading = async () => ({ extraction: letterA(), modelId: "fake-reader" });
    await api.analyze(jsonReq(`/api/letters/${id}/analyze`, {}), id, d);
    const saved = clock;
    clock = new Date(saved.getTime() + 31 * 86_400_000);
    try {
      expect((await api.getImage(get("/x"), id, d)).status).toBe(410);
      const env = LetterEnvelopeZ.parse(await (await api.getLetter(get("/x"), id, d)).json());
      expect(env.result?.image).toBeNull(); // the analysis stays; the photo is gone
    } finally {
      clock = saved;
    }
  });
});
