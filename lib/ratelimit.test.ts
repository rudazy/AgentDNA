import { afterEach, describe, expect, it } from "vitest";
import {
  checkWindowRateLimit,
  PLAYGROUND_MAX_PER_HOUR,
  PLAYGROUND_WINDOW_MS,
  resetRateLimitState,
} from "./ratelimit";

describe("playground window rate limit", () => {
  afterEach(() => {
    resetRateLimitState();
  });

  it("allows 10 requests then returns 429 on the 11th within the hour", () => {
    const key = "playground:test-ip";
    const start = 1_700_000_000_000;

    for (let i = 0; i < PLAYGROUND_MAX_PER_HOUR; i++) {
      const r = checkWindowRateLimit(
        key,
        PLAYGROUND_MAX_PER_HOUR,
        PLAYGROUND_WINDOW_MS,
        start + i * 1000,
      );
      expect(r.allowed).toBe(true);
    }

    const blocked = checkWindowRateLimit(
      key,
      PLAYGROUND_MAX_PER_HOUR,
      PLAYGROUND_WINDOW_MS,
      start + PLAYGROUND_MAX_PER_HOUR * 1000,
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const key = "playground:window-reset";
    const start = 1_700_000_000_000;

    for (let i = 0; i < PLAYGROUND_MAX_PER_HOUR; i++) {
      checkWindowRateLimit(
        key,
        PLAYGROUND_MAX_PER_HOUR,
        PLAYGROUND_WINDOW_MS,
        start + i,
      );
    }

    const afterWindow = checkWindowRateLimit(
      key,
      PLAYGROUND_MAX_PER_HOUR,
      PLAYGROUND_WINDOW_MS,
      start + PLAYGROUND_WINDOW_MS + 1,
    );
    expect(afterWindow.allowed).toBe(true);
  });
});
