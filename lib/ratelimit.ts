/**
 * Simple in-memory token bucket rate limiter.
 *
 * SERVERLESS CAVEAT: each Vercel isolate has its own memory. This limits burst
 * abuse within a single instance only. It does not provide global distributed
 * rate limiting. For production scale, replace with edge config or Upstash Redis.
 */

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, Bucket>();

const DEFAULT_CAPACITY = 30;
const DEFAULT_REFILL_PER_SEC = 0.5; // 30 per minute steady state

export function checkRateLimit(
  key: string,
  capacity = DEFAULT_CAPACITY,
  refillPerSec = DEFAULT_REFILL_PER_SEC,
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { tokens: capacity, lastRefillMs: now };
    buckets.set(key, bucket);
  }

  const elapsedSec = (now - bucket.lastRefillMs) / 1000;
  const refill = elapsedSec * refillPerSec;
  bucket.tokens = Math.min(capacity, bucket.tokens + refill);
  bucket.lastRefillMs = now;

  if (bucket.tokens < 1) {
    return { allowed: false, remaining: 0 };
  }

  bucket.tokens -= 1;
  return { allowed: true, remaining: Math.floor(bucket.tokens) };
}

export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "unknown";
}

/**
 * Sliding-window rate limit (timestamps per key).
 * Used by the free playground: 10 requests per hour.
 *
 * SERVERLESS CAVEAT: same as token bucket. Per-isolate only, not global.
 */
const windowHits = new Map<string, number[]>();

export function checkWindowRateLimit(
  key: string,
  maxHits: number,
  windowMs: number,
  nowMs = Date.now(),
): { allowed: boolean; remaining: number; retryAfterSec: number } {
  const cutoff = nowMs - windowMs;
  const prev = windowHits.get(key) ?? [];
  const recent = prev.filter((t) => t > cutoff);

  if (recent.length >= maxHits) {
    windowHits.set(key, recent);
    const oldest = recent[0] ?? nowMs;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((oldest + windowMs - nowMs) / 1000),
    );
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  recent.push(nowMs);
  windowHits.set(key, recent);
  return {
    allowed: true,
    remaining: Math.max(0, maxHits - recent.length),
    retryAfterSec: 0,
  };
}

/** Test helper: clear in-memory limiters. */
export function resetRateLimitState(): void {
  buckets.clear();
  windowHits.clear();
}

/** Playground: 10 requests per rolling hour. */
export const PLAYGROUND_MAX_PER_HOUR = 10;
export const PLAYGROUND_WINDOW_MS = 60 * 60 * 1000;
