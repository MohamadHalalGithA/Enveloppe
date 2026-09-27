import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AuthError, ConflictError, NotFoundError, PipelineError, type PipelineErrorCode } from "@/lib/errors";
import { logEvent } from "@/lib/log";

/**
 * HTTP plumbing shared by every API route: safe error responses, same-origin checks for mutations,
 * bounded JSON bodies, id validation, and request logging without any letter content.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const PIPELINE: Record<PipelineErrorCode, { status: number; message: string }> = {
  IMAGE_UNSUPPORTED: { status: 415, message: "Please upload a photo of the letter (JPG, PNG or WebP)." },
  IMAGE_TOO_LARGE: { status: 413, message: "That file is too large. The limit is 8 MB." },
  IMAGE_UNREADABLE: { status: 422, message: "We couldn't open that image. Try taking the photo again." },
  EXTRACTION_INVALID: { status: 422, message: "We couldn't read this letter. Try a clearer, flatter photo." },
  SERVICE_UNAVAILABLE: { status: 503, message: "The reading service is busy. Your letter is saved; try again in a minute." },
  CONFIG_MISSING: { status: 500, message: "The server isn't configured correctly." },
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

/** Maps any thrown error to a safe response. Never returns stack traces, SQL, provider bodies or letter text. */
export function toErrorResponse(e: unknown): { response: Response; code: string } {
  if (e instanceof HttpError) return { response: json(errorBody(e.code, e.message), e.status, e.headers), code: e.code };
  if (e instanceof AuthError) return { response: json(errorBody(e.code, "Sign in required"), 401), code: e.code };
  if (e instanceof NotFoundError) return { response: json(errorBody(e.code, e.message), 404), code: e.code };
  if (e instanceof ConflictError) return { response: json(errorBody(e.code, e.message), 409), code: e.code };
  if (e instanceof PipelineError) {
    const m = PIPELINE[e.code];
    return { response: json(errorBody(e.code, m.message), m.status), code: e.code };
  }
  if (e instanceof z.ZodError) {
    // Field paths only: never echo submitted values back.
    const fields = [...new Set(e.issues.map((i) => i.path.join(".") || "(body)"))].slice(0, 10);
    return { response: json(errorBody("BAD_REQUEST", `Invalid request: ${fields.join(", ")}`), 400), code: "BAD_REQUEST" };
  }
  return { response: json(errorBody("INTERNAL", "Something went wrong. Please try again."), 500), code: "INTERNAL" };
}

/** Wraps a handler: request id, timing, error mapping, and a content-free log line. */
export async function withApi(route: string, fn: (ctx: { requestId: string }) => Promise<Response>): Promise<Response> {
  const requestId = randomUUID();
  const started = Date.now();
  let status = 500;
  let code: string | undefined;
  try {
    const res = await fn({ requestId });
    status = res.status;
    return res;
  } catch (e) {
    const mapped = toErrorResponse(e);
    status = mapped.response.status;
    code = mapped.code;
    if (status >= 500) logEvent({ level: "error", requestId, route, status, code, error: e instanceof Error ? e.name : typeof e });
    return mapped.response;
  } finally {
    logEvent({ level: "info", requestId, route, status, code, ms: Date.now() - started });
  }
}

/**
 * CSRF defense for state-changing requests: the browser's Origin must be our own origin.
 * Missing Origin is rejected too (browsers always send it on cross-site POST/DELETE).
 */
export function assertSameOrigin(request: Request, appOrigin: string): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== appOrigin) throw new HttpError(403, "FORBIDDEN_ORIGIN", "This request must come from the Enveloppe app.");
}

/** Route ids must be UUIDs; anything else is simply not found (no parsing errors to probe). */
export function parseId(id: string): string {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError();
  return id;
}

/** Reads a small JSON body with a hard size cap, then validates it with the given schema. */
export async function readJson<T>(request: Request, schema: z.ZodType<T>, maxBytes = 16 * 1024): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new HttpError(413, "BODY_TOO_LARGE", "Request body too large.");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "BODY_TOO_LARGE", "Request body too large.");
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "Request body must be JSON.");
  }
  return schema.parse(data);
}
