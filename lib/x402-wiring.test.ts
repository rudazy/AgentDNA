import { describe, expect, it, vi } from "vitest";
import {
  describeWiringFailure,
  redactSecrets,
  resolveGate,
  wiringErrorBody,
  type AppRouteHandler,
} from "./x402-wiring";

const okHandler = (() => Promise.resolve({} as never)) as AppRouteHandler;

function steps(overrides: Partial<Parameters<typeof resolveGate>[0]> = {}) {
  return {
    resourceServer: () => ({ server: true }),
    routeConfig: () => ({ config: true }),
    wrap: () => okHandler,
    ...overrides,
  };
}

describe("resolveGate", () => {
  it("returns the gated handler when every step succeeds", () => {
    const result = resolveGate(steps());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.handler).toBe(okHandler);
  });

  it("reports the facilitator stage when the resource server throws", () => {
    const result = resolveGate(
      steps({
        resourceServer: () => {
          throw new Error("OKX_API_KEY is required");
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.stage).toBe("facilitator");
      expect(result.failure.detail).toContain("OKX_API_KEY is required");
    }
  });

  it("reports the route-config stage when the config throws", () => {
    const result = resolveGate(
      steps({
        routeConfig: () => {
          throw new Error("X402_PAYTO_ADDRESS is required");
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.stage).toBe("route-config");
      expect(result.failure.detail).toContain("X402_PAYTO_ADDRESS");
    }
  });

  it("reports the middleware stage when wrapping throws", () => {
    const result = resolveGate(
      steps({
        wrap: () => {
          throw new Error("withX402 exploded");
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.stage).toBe("middleware");
  });

  it("does not run later steps once one has failed", () => {
    const routeConfig = vi.fn(() => ({}));
    const wrap = vi.fn(() => okHandler);
    resolveGate(
      steps({
        resourceServer: () => {
          throw new Error("boom");
        },
        routeConfig,
        wrap,
      }),
    );
    expect(routeConfig).not.toHaveBeenCalled();
    expect(wrap).not.toHaveBeenCalled();
  });
});

describe("wiringErrorBody", () => {
  it("returns 503 and names the failing stage", () => {
    const { status, body } = wiringErrorBody({
      stage: "facilitator",
      detail: "bad credentials",
    });
    // 503 not 402: paying cannot fix a seller that cannot settle.
    expect(status).toBe(503);
    expect(body.code).toBe("X402_WIRING_FAILED");
    expect(body.stage).toBe("facilitator");
    expect(String(body.details)).toContain("x402 facilitator construction");
    expect(String(body.details)).toContain("bad credentials");
  });

  it("never advertises a price for a broken gate", () => {
    const { body } = wiringErrorBody({ stage: "request", detail: "timeout" });
    expect(body).not.toHaveProperty("accepts");
    expect(JSON.stringify(body)).not.toContain("$0.50");
  });
});

describe("redactSecrets", () => {
  const env = {
    OKX_SECRET_KEY: "super-secret-value-123",
    OKX_PASSPHRASE: "passphrase-abcdef",
    FOREMAN_FLOAT_PRIVATE_KEY: `0x${"a".repeat(64)}`,
    SHORT: "abc",
  };

  it("removes configured secret values", () => {
    const out = redactSecrets(
      "auth failed for super-secret-value-123 using passphrase-abcdef",
      env,
    );
    expect(out).not.toContain("super-secret-value-123");
    expect(out).not.toContain("passphrase-abcdef");
    expect(out).toContain("[redacted]");
  });

  it("removes a private key quoted back by an SDK error", () => {
    const out = redactSecrets(`signer rejected key 0x${"a".repeat(64)}`, env);
    expect(out).not.toContain("a".repeat(64));
  });

  it("caps length so a long trace cannot be exfiltrated", () => {
    const out = redactSecrets("x".repeat(5000), env);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.endsWith("...")).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    expect(redactSecrets("plain failure", env)).toBe("plain failure");
  });
});

describe("describeWiringFailure", () => {
  it("scrubs secrets out of the reported detail", () => {
    const env = { OKX_SECRET_KEY: "leaky-secret-value" };
    const failure = describeWiringFailure(
      "request",
      new Error("upstream rejected leaky-secret-value"),
      env,
    );
    expect(failure.stage).toBe("request");
    expect(failure.detail).not.toContain("leaky-secret-value");
    expect(failure.detail).toContain("[redacted]");
  });

  it("handles non-Error throws", () => {
    const failure = describeWiringFailure("middleware", "string failure", {});
    expect(failure.detail).toBe("string failure");
  });
});
