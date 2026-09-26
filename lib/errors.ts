/** Pipeline error with a safe, client-presentable code. Messages must never contain letter content. */
export type PipelineErrorCode =
  | "IMAGE_UNSUPPORTED"
  | "IMAGE_TOO_LARGE"
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
