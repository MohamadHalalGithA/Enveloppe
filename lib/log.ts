/**
 * Structured logs. By construction there's no field for letter text, images, model payloads, tokens,
 * cookies or headers: only ids, route, status, error category and timing (CLAUDE.md "Logging").
 */
export interface LogEvent {
  level: "info" | "error";
  requestId: string;
  route: string;
  status: number;
  code?: string;
  ms?: number;
  /** Error class name only (never the message, which could echo input). */
  error?: string;
}

export function logEvent(e: LogEvent): void {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), ...e });
  if (e.level === "error") console.error(line);
  else console.info(line);
}
