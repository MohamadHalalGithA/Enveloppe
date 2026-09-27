/**
 * Live end-to-end through the real API handlers: upload (sanitize + store) → analyze with REAL Gemini on
 * the sanitized image → case decision → scam twin. Only authentication is substituted (a fixed test user),
 * because Auth0 sign-in can't run headless. Synthetic letters only.
 */
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { LetterResultZ, UploadResultZ } from "@/lib/contracts";
import * as api from "@/lib/api/handlers";
import type { ApiDeps } from "@/lib/api/handlers";
import { RateLimiter } from "@/lib/api/rate-limit";
import { resolveUser } from "@/lib/auth/resolve";
import { openPglite } from "@/lib/db/client";
import { extractFromImage } from "@/lib/gemini/client";

try {
  process.loadEnvFile(".env.local");
} catch {
  // env may come from the shell
}

const ORIGIN = "http://localhost:3000";
let d: ApiDeps;

async function uploadAndAnalyze(file: string) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(await readFile(`demo/letters/out/${file}`))], file));
  const encoded = new Response(form);
  const body = Buffer.from(await encoded.arrayBuffer());
  const up = await api.uploadLetter(
    new Request(`${ORIGIN}/api/letters`, {
      method: "POST",
      body,
      headers: { origin: ORIGIN, "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length) },
    }),
    d,
  );
  const { letterId } = UploadResultZ.parse(await up.json());
  const res = await api.analyze(
    new Request(`${ORIGIN}/api/letters/${letterId}/analyze`, { method: "POST", headers: { origin: ORIGIN, "content-length": "0" } }),
    letterId,
    d,
  );
  expect(res.status).toBe(200);
  return LetterResultZ.parse(await res.json());
}

beforeAll(async () => {
  const db = await openPglite();
  const user = await resolveUser(db, "auth0|live-api-test");
  d = {
    user: async () => user,
    db: async () => db,
    extract: extractFromImage,
    today: () => "2026-09-27",
    now: () => new Date(),
    refKey: () => "live-api-test-key-".repeat(4),
    appOrigin: ORIGIN,
    limiter: new RateLimiter(),
    retentionDays: 30,
  };
}, 60_000);

describe("live API pipeline", () => {
  it("reads Sample A from the sanitized upload and verifies it", async () => {
    const a = await uploadAndAnalyze("A_cra_ccb_review.png");
    expect(a.verdict).toBe("CONSISTENT_WITH_TRUSTED_SOURCES");
    expect(a.deadline.effective).toBe("2026-10-14");
    expect(a.image).toMatchObject({ width: 1275, height: 1650 });
    const res = await api.decide(
      new Request(`${ORIGIN}/api/letters/${a.id}/case`, {
        method: "POST",
        body: JSON.stringify({ decision: "new" }),
        headers: { origin: ORIGIN, "content-type": "application/json", "content-length": "19" },
      }),
      a.id,
      d,
    );
    expect(LetterResultZ.parse(await res.json()).filedIn?.title).toMatch(/^CRA: Canada child benefit review$/i);
  });

  it("catches Sample B against Sample A's case, with the QR decoded from the stored image", async () => {
    const b = await uploadAndAnalyze("B_cra_twin_scam.png");
    expect(b.verdict).toBe("CONTRADICTIONS_FOUND");
    expect(b.caseMatch.decision).toBe("ASK_CONFLICT");
    expect(b.items.find((i) => i.claimType === "qr")?.letterValue).toBe("cra-canada-verify.example");
    expect(b.items.find((i) => i.claimType === "reference")?.status).toBe("VERIFIED_CONTRADICTION");
  });
});
