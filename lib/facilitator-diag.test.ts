import { describe, expect, it } from "vitest";
import { diagnoseFacilitator, fingerprint } from "./facilitator-diag";

const ENV = {
  OKX_API_KEY: "sa-api-key-value-1234",
  OKX_SECRET_KEY: "sa-secret-key-value-5678",
  OKX_PASSPHRASE: "sa-passphrase-value",
  OKXOS_API_KEY: "dataportal-key-value-9999",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const XLAYER_KIND = { x402Version: 2, network: "eip155:196", scheme: "exact" };

describe("diagnoseFacilitator", () => {
  it("reports healthy when an eip155:196 exact kind is offered", async () => {
    const result = await diagnoseFacilitator(ENV, async () =>
      jsonResponse({ data: { kinds: [XLAYER_KIND] } }),
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.hasXLayerExactKind).toBe(true);
    expect(result.diagnosis).toContain("Healthy");
  });

  it("calls the exact path the SDK calls, with the signed headers", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    await diagnoseFacilitator(ENV, async (url, init) => {
      seenUrl = String(url);
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return jsonResponse({ data: { kinds: [XLAYER_KIND] } });
    });
    expect(seenUrl).toBe("https://web3.okx.com/api/v6/pay/x402/supported");
    expect(seenHeaders["OK-ACCESS-KEY"]).toBe(ENV.OKX_API_KEY);
    expect(seenHeaders["OK-ACCESS-SIGN"]).toBeTruthy();
    expect(seenHeaders["OK-ACCESS-TIMESTAMP"]).toBeTruthy();
  });

  it("calls the real host when the base URL env var is unset", async () => {
    // Regression: the SDK was previously handed baseUrl undefined, which its
    // object spread turned into the literal "undefined" in the request URL.
    let seenUrl = "";
    const result = await diagnoseFacilitator(ENV, async (url) => {
      seenUrl = String(url);
      return jsonResponse({ data: { kinds: [XLAYER_KIND] } });
    });
    expect(seenUrl).not.toContain("undefined");
    expect(seenUrl).toBe("https://web3.okx.com/api/v6/pay/x402/supported");
    expect(result.baseUrl).toBe("https://web3.okx.com");
    expect(result.baseUrlConfigured).toBe(false);
  });

  it("separates an empty kinds list from a rejected credential", async () => {
    const empty = await diagnoseFacilitator(ENV, async () =>
      jsonResponse({ data: { kinds: [] } }),
    );
    expect(empty.ok).toBe(false);
    expect(empty.status).toBe(200);
    expect(empty.diagnosis).toContain("not provisioned");

    const rejected = await diagnoseFacilitator(ENV, async () =>
      jsonResponse({ msg: "invalid key" }, 401),
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.status).toBe(401);
    expect(rejected.diagnosis).toContain("Credentials rejected");
  });

  it("flags a 404 as a base URL problem", async () => {
    const result = await diagnoseFacilitator(ENV, async () =>
      jsonResponse({ msg: "not found" }, 404),
    );
    expect(result.diagnosis).toContain("OKX_FACILITATOR_BASE_URL");
  });

  it("warns when the base URL carries the wrong path suffix", async () => {
    const result = await diagnoseFacilitator(
      { ...ENV, OKX_FACILITATOR_BASE_URL: "https://web3.okx.com/facilitator" },
      async () => jsonResponse({ data: { kinds: [XLAYER_KIND] } }),
    );
    expect(result.baseUrlWarning).toContain("/facilitator");
  });

  it("detects the data API key being used as the settlement key", async () => {
    const result = await diagnoseFacilitator(
      { ...ENV, OKX_API_KEY: ENV.OKXOS_API_KEY },
      async () => jsonResponse({ data: { kinds: [] } }),
    );
    expect(result.credentials.sameKeyAsOkxosDataApi).toBe(true);
  });

  it("reports kinds that exist but do not match X Layer exact", async () => {
    const result = await diagnoseFacilitator(ENV, async () =>
      jsonResponse({
        data: { kinds: [{ x402Version: 2, network: "eip155:8453", scheme: "exact" }] },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.kindCount).toBe(1);
    expect(result.hasXLayerExactKind).toBe(false);
    expect(result.diagnosis).toContain("none match");
  });

  it("handles an unreachable host without throwing", async () => {
    const result = await diagnoseFacilitator(ENV, async () => {
      throw new Error("getaddrinfo ENOTFOUND web3.okx.com");
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBeNull();
    expect(result.diagnosis).toContain("unreachable");
  });

  it("reports missing credentials without calling out", async () => {
    let called = false;
    const result = await diagnoseFacilitator({}, async () => {
      called = true;
      return jsonResponse({});
    });
    expect(called).toBe(false);
    expect(result.diagnosis).toContain("missing");
  });

  it("never puts a secret value in the result", async () => {
    const results = [
      await diagnoseFacilitator(ENV, async () =>
        jsonResponse({ msg: `rejected key ${ENV.OKX_API_KEY}` }, 401),
      ),
      await diagnoseFacilitator(ENV, async () => {
        throw new Error(`connect failed using ${ENV.OKX_SECRET_KEY}`);
      }),
      await diagnoseFacilitator(ENV, async () =>
        jsonResponse({ data: { kinds: [XLAYER_KIND] } }),
      ),
    ];
    for (const result of results) {
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(ENV.OKX_API_KEY);
      expect(serialized).not.toContain(ENV.OKX_SECRET_KEY);
      expect(serialized).not.toContain(ENV.OKX_PASSPHRASE);
    }
  });

  it("exposes only a short non-reversible key fingerprint", async () => {
    const result = await diagnoseFacilitator(ENV, async () =>
      jsonResponse({ data: { kinds: [XLAYER_KIND] } }),
    );
    expect(result.credentials.apiKeyFingerprint).toBe(
      fingerprint(ENV.OKX_API_KEY),
    );
    expect(result.credentials.apiKeyFingerprint).toHaveLength(8);
    expect(result.credentials.apiKeyFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });
});
