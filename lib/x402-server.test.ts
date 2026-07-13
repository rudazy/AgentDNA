import { describe, expect, it } from "vitest";
import { PRICES, USDT0_ADDRESS, X_LAYER_NETWORK } from "./constants";
import { buildUnpaidChallengeBody } from "./x402-challenge";

describe("buildUnpaidChallengeBody", () => {
  it("shapes agent scan 402 challenge with $0.05 and exact scheme", () => {
    const body = buildUnpaidChallengeBody("agent", "0xPayToAddress");
    expect(body.code).toBe("PAYMENT_REQUIRED");
    expect(body.x402Version).toBe(2);
    expect(body.accepts).toHaveLength(1);
    const accept = body.accepts[0]!;
    expect(accept.scheme).toBe("exact");
    expect(accept.network).toBe(X_LAYER_NETWORK);
    expect(accept.network).toBe("eip155:196");
    expect(accept.price).toBe(PRICES.agent);
    expect(accept.price).toBe("$0.05");
    expect(accept.payTo).toBe("0xPayToAddress");
    expect(accept.asset).toBe(USDT0_ADDRESS);
    expect(accept.maxTimeoutSeconds).toBe(300);
    expect(body.headersHint).toContain("PAYMENT-SIGNATURE");
    expect(body.headersHint).toContain("X-PAYMENT");
    expect(JSON.stringify(body)).not.toMatch(/\u2014/);
  });

  it("shapes token scan 402 challenge with $0.01", () => {
    const body = buildUnpaidChallengeBody("token", "0xPayToAddress");
    expect(body.accepts[0]!.price).toBe("$0.01");
    expect(body.accepts[0]!.scheme).toBe("exact");
    expect(body.details.toLowerCase()).toContain("token");
  });
});
