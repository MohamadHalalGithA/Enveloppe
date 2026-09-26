import type { z } from "zod";
import { ExtractionZ, type CivilDate, type Extraction } from "@/lib/contracts";
import { PipelineError } from "@/lib/errors";
import { guardExtraction, preSanitize } from "./guard";
import type { ImageMime } from "./image";
import { repairNote } from "./prompt";

/**
 * Extraction orchestrator: image → Gemini → JSON → Zod → Contract Guard.
 * Provider-agnostic: the network call is injected, so this is unit-testable without Gemini.
 */

export interface GenerateRequest {
  model: string;
  image: Buffer;
  mimeType: ImageMime;
  promptSuffix: string;
  signal: AbortSignal;
}
export type GenerateFn = (req: GenerateRequest) => Promise<string>;

export interface ExtractOptions {
  /** Primary first. The primary is tried twice, then each fallback once. */
  models: string[];
  generate: GenerateFn;
  today: CivilDate;
  timeoutMs?: number;
  /** Test hook; defaults to real backoff. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ExtractResult {
  extraction: Extraction;
  modelId: string;
  attempts: { model: string; outcome: "ok" | "invalid_output" | "provider_error"; status?: number }[];
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function providerStatus(e: unknown): number | undefined {
  const s = (e as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

function isRetryableProviderError(e: unknown): boolean {
  const status = providerStatus(e);
  if (status !== undefined) return RETRYABLE_STATUS.has(status);
  const name = (e as { name?: string })?.name;
  // Timeouts, aborts and network failures carry no HTTP status.
  return name === "AbortError" || name === "TimeoutError" || e instanceof TypeError;
}

function zodPaths(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((i) => i.path.join(".") || "(root)"))];
}

export function attemptPlan(models: string[]): string[] {
  const [primary, ...fallbacks] = models.filter(Boolean);
  if (!primary) throw new PipelineError("CONFIG_MISSING", "No Gemini model configured");
  return [primary, primary, ...fallbacks.filter((m) => m !== primary)];
}

export async function extractLetter(
  image: Buffer,
  mimeType: ImageMime,
  opts: ExtractOptions,
): Promise<ExtractResult> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const attempts: ExtractResult["attempts"] = [];
  let lastPaths: string[] = [];
  let lastKind: "invalid_output" | "provider_error" = "provider_error";

  const plan = attemptPlan(opts.models);
  for (let i = 0; i < plan.length; i++) {
    const model = plan[i];
    let raw: string;
    try {
      raw = await opts.generate({
        model,
        image,
        mimeType,
        promptSuffix: lastPaths.length ? repairNote(lastPaths) : "",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
      });
    } catch (e) {
      const status = providerStatus(e);
      attempts.push({ model, outcome: "provider_error", status });
      lastKind = "provider_error";
      if (!isRetryableProviderError(e)) {
        // 400/401/403/404: configuration or request problem. Retrying the same call won't help,
        // but a different fallback model might (e.g. a model that isn't available on this key).
        const next = plan.slice(i + 1).find((m) => m !== model);
        if (!next) break;
        i = plan.indexOf(next) - 1;
        continue;
      }
      if (i < plan.length - 1) await sleep(Math.min(4000, 600 * 2 ** i));
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      attempts.push({ model, outcome: "invalid_output" });
      lastKind = "invalid_output";
      lastPaths = ["(root): not valid JSON"];
      continue;
    }
    const parsed = ExtractionZ.safeParse(preSanitize(json));
    if (!parsed.success) {
      attempts.push({ model, outcome: "invalid_output" });
      lastKind = "invalid_output";
      lastPaths = zodPaths(parsed.error);
      continue;
    }
    attempts.push({ model, outcome: "ok" });
    return { extraction: guardExtraction(parsed.data, { today: opts.today }), modelId: model, attempts };
  }

  throw new PipelineError(
    lastKind === "invalid_output" ? "EXTRACTION_INVALID" : "SERVICE_UNAVAILABLE",
    `Extraction failed after ${attempts.length} attempts`,
  );
}
