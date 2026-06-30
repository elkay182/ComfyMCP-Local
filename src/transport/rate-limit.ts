export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

type Bucket = {
  count: number;
  resetAt: number;
};

export class FixedWindowRateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #buckets = new Map<string, Bucket>();

  constructor(limit: number, windowMs = 60_000) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    const bucket = this.currentBucket(key, now);
    bucket.count += 1;
    if (bucket.count <= this.#limit) {
      return { ok: true };
    }
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000))
    };
  }

  private currentBucket(key: string, now: number): Bucket {
    const existing = this.#buckets.get(key);
    if (existing && existing.resetAt > now) {
      return existing;
    }
    this.gc(now);
    const next = {
      count: 0,
      resetAt: now + this.#windowMs
    };
    this.#buckets.set(key, next);
    return next;
  }

  private gc(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) {
        this.#buckets.delete(key);
      }
    }
  }
}
