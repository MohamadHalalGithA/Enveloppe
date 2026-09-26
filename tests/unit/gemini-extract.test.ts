import { describe, expect, it, vi } from "vitest";
import { extractLetter, type GenerateFn, type GenerateRequest } from "@/lib/gemini/extract";
import { PipelineError } from "@/lib/errors";
import fixtureA from "@/demo/fixtures/letter-a-cra-review.extraction.json";

const image = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const valid = JSON.stringify(fixtureA);
const providerError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

function run(responses: (string | Error)[], models = ["primary", "fallback"]) {
  const calls: GenerateRequest[] = [];
  const generate: GenerateFn = async (req) => {
    calls.push(req);
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected call");
    if (next instanceof Error) throw next;
    return next;
  };
  const sleep = vi.fn(async () => {});
  const promise = extractLetter(image, "image/jpeg", { models, generate, today: "2026-09-27", sleep });
  return { promise, calls, sleep };
}

describe("extractLetter", () => {
  it("returns a guarded extraction on the first valid response", async () => {
    const { promise, calls } = run([valid]);
    const r = await promise;
    expect(r.modelId).toBe("primary");
    expect(r.extraction.issueDate.value).toBe("2026-09-14");
    expect(calls).toHaveLength(1);
    expect(calls[0].promptSuffix).toBe("");
  });

  it("retries malformed JSON with a repair note that names paths, never content", async () => {
    const { promise, calls } = run(["{not json", valid]);
    await promise;
    expect(calls).toHaveLength(2);
    expect(calls[1].promptSuffix).toContain("not valid JSON");
  });

  it("retries schema-invalid output and lists the failing paths", async () => {
    const broken = JSON.stringify({ ...fixtureA, issueDate: { ...fixtureA.issueDate, value: "14/09/2026" } });
    const { promise, calls } = run([broken, valid]);
    const r = await promise;
    expect(r.attempts.map((a) => a.outcome)).toEqual(["invalid_output", "ok"]);
    expect(calls[1].promptSuffix).toContain("issueDate.value");
    expect(calls[1].promptSuffix).not.toContain("14/09/2026");
  });

  it("backs off on overload and falls back to the second model", async () => {
    const { promise, calls, sleep } = run([providerError(503), providerError(429), valid]);
    const r = await promise;
    expect(calls.map((c) => c.model)).toEqual(["primary", "primary", "fallback"]);
    expect(r.modelId).toBe("fallback");
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("skips straight to the fallback when the primary model is unavailable (404)", async () => {
    const { promise, calls } = run([providerError(404), valid]);
    await promise;
    expect(calls.map((c) => c.model)).toEqual(["primary", "fallback"]);
  });

  it("fails with EXTRACTION_INVALID when every response is invalid", async () => {
    const { promise } = run(["[]", "{}", "nope"]);
    await expect(promise).rejects.toMatchObject({ code: "EXTRACTION_INVALID" });
  });

  it("fails with SERVICE_UNAVAILABLE when the provider keeps failing", async () => {
    const { promise } = run([providerError(503), providerError(503), providerError(503)]);
    await expect(promise).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("requires a configured model", async () => {
    await expect(run([], []).promise).rejects.toBeInstanceOf(PipelineError);
  });
});
