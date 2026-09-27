import { HttpError } from "./http";

/**
 * Per-user sliding-window rate limits for expensive or abusable operations (Blueprint Part 21).
 * In-memory: right for the single-instance deployment; a shared store would be needed to scale out.
 * Supplements authentication; never replaces it.
 */

export const LIMITS = {
  upload: { limit: 10, windowMs: 60_000 },
  analyze: { limit: 6, windowMs: 60_000 },
  mutate: { limit: 60, windowMs: 60_000 },
} as const;
export type Bucket = keyof typeof LIMITS;

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly clock: () => number = Date.now) {}

  take(bucket: Bucket, key: string): { ok: true } | { ok: false; retryAfterSec: number } {
    const { limit, windowMs } = LIMITS[bucket];
    const now = this.clock();
    const id = `${bucket}:${key}`;
    const recent = (this.hits.get(id) ?? []).filter((t) => t > now - windowMs);
    if (recent.length >= limit) {
      this.hits.set(id, recent);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.hits.set(id, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return { ok: true };
  }

  enforce(bucket: Bucket, key: string): void {
    const r = this.take(bucket, key);
    if (!r.ok) {
      throw new HttpError(429, "RATE_LIMITED", "Too many requests. Please wait a moment.", { "Retry-After": String(r.retryAfterSec) });
    }
  }

  private prune(now: number) {
    const longest = Math.max(...Object.values(LIMITS).map((l) => l.windowMs));
    for (const [k, v] of this.hits) if (!v.some((t) => t > now - longest)) this.hits.delete(k);
  }
}
