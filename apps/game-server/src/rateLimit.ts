/**
 * In-process token-bucket limiter for the single-instance authoritative deployment.
 *
 * Two surfaces need throttling for different reasons:
 *
 * - `POST /api/game/session` is unauthenticated and turns a caller-supplied login token into a
 *   player identity. Without a limit it is an online guessing oracle, so it is keyed by client
 *   address.
 * - Command execution is authenticated but expensive: each call runs the installed simulation and
 *   commits a durable transaction. It is keyed by player so one session cannot starve the others.
 *
 * The bucket table is bounded. An unbounded key space keyed by attacker-chosen addresses would
 * trade a request-rate problem for a memory-exhaustion one.
 */

export interface RateLimitOptions {
  /** Sustained refill rate. */
  readonly perMinute: number;
  /** Bucket depth: requests admitted instantly when the key is idle. */
  readonly burst: number;
  /** Upper bound on tracked keys before the least-recently-used entries are dropped. */
  readonly maxTrackedKeys?: number;
  readonly now?: () => number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Whole seconds a rejected caller should wait before retrying. At least 1. */
  readonly retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const DEFAULT_MAX_TRACKED_KEYS = 10_000;

export class RateLimiter {
  private readonly refillPerMs: number;
  private readonly burst: number;
  private readonly maxTrackedKeys: number;
  private readonly now: () => number;


  private readonly buckets = new Map<string, Bucket>();

  constructor(options: RateLimitOptions) {
    if (!Number.isFinite(options.perMinute) || options.perMinute <= 0) {
      throw new Error("rate limit perMinute must be a positive number");
    }
    if (!Number.isFinite(options.burst) || options.burst <= 0) {
      throw new Error("rate limit burst must be a positive number");
    }
    this.refillPerMs = options.perMinute / 60_000;
    this.burst = options.burst;
    this.maxTrackedKeys = options.maxTrackedKeys ?? DEFAULT_MAX_TRACKED_KEYS;
    this.now = options.now ?? Date.now;
  }

  /** Consumes one token for `key`, reporting whether the caller may proceed. */
  take(key: string): RateLimitDecision {
    const now = this.now();
    const existing = this.buckets.get(key);
    const bucket: Bucket = existing ?? { tokens: this.burst, updatedAt: now };
    if (existing !== undefined) {
      const elapsed = Math.max(0, now - existing.updatedAt);
      bucket.tokens = Math.min(this.burst, existing.tokens + elapsed * this.refillPerMs);
      bucket.updatedAt = now;

      this.buckets.delete(key);
    }

    let decision: RateLimitDecision;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      decision = { allowed: true, retryAfterSeconds: 0 };
    } else {
      const millisecondsUntilToken = (1 - bucket.tokens) / this.refillPerMs;
      decision = {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(millisecondsUntilToken / 1000)),
      };
    }

    this.buckets.set(key, bucket);
    // A full bucket carries no information, so dropping it is lossless: the key would be recreated
    // full anyway. That makes eviction safe rather than a limiter bypass.
    if (this.buckets.size > this.maxTrackedKeys) this.evictOldest();
    return decision;
  }

  /** Test/observability hook. */
  get trackedKeyCount(): number {
    return this.buckets.size;
  }

  private evictOldest(): void {
    const excess = this.buckets.size - this.maxTrackedKeys;
    let removed = 0;
    for (const key of this.buckets.keys()) {
      if (removed >= excess) break;
      this.buckets.delete(key);
      removed += 1;
    }
  }
}

/**
 * Resolves the address a limiter should key on.
 *
 * `X-Forwarded-For` is caller-controlled and is only consulted when the operator has asserted that
 * a trusted reverse proxy is the sole path to this port. The *last* entry is the hop the trusted
 * proxy itself observed; earlier entries may be forged by the client.
 */
export function resolveClientAddress(
  forwardedFor: string | string[] | undefined,
  socketAddress: string | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy && forwardedFor !== undefined) {
    const header = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor;
    const hops = header.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    const nearest = hops[hops.length - 1];
    if (nearest !== undefined) return nearest;
  }
  return socketAddress ?? "unknown";
}
