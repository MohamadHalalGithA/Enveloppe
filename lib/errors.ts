/** Pipeline error with a safe, client-presentable code. Messages must never contain letter content. */
export type PipelineErrorCode =
  | "IMAGE_UNSUPPORTED"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_UNREADABLE"
  | "EXTRACTION_INVALID"
  | "SERVICE_UNAVAILABLE"
  | "CONFIG_MISSING";

export class PipelineError extends Error {
  constructor(
    public readonly code: PipelineErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

/** Resource missing OR not owned by the requester: both return 404 so ownership can't be probed. */
export class NotFoundError extends Error {
  readonly status = 404;
  readonly code = "NOT_FOUND";
  constructor(what = "Resource") {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** The request conflicts with the resource's current state (e.g. completing a task twice). */
export class ConflictError extends Error {
  readonly status = 409;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

/** No valid authenticated session. Never fall back to client-supplied identity. */
export class AuthError extends Error {
  readonly status = 401;
  readonly code = "UNAUTHENTICATED";
  constructor() {
    super("Authentication required");
    this.name = "AuthError";
  }
}
