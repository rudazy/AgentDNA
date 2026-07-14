import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOkxAccessHeaders,
  ChainDataError,
  classifyEnvelopeError,
  getCredentials,
  mapHolders,
  mapTrade,
  mapTx,
  mapTxStatus,
  normalizePercent,
  okxAccessTimestamp,
  signOkxAccess,
} from "./chaindata";

describe("signOkxAccess", () => {
  it("matches Base64 HMAC-SHA256 of timestamp + METHOD + requestPath + body", () => {
    const secret = "test-secret-key";
    const timestamp = "2026-07-14T12:00:00.000Z";
    const method = "GET";
    const requestPath =
      "/api/v6/dex/post-transaction/transactions-by-address?address=0xabc&chains=196&limit=20";
    const body = "";

    const expected = createHmac("sha256", secret)
      .update(timestamp + method + requestPath + body, "utf8")
      .digest("base64");

    expect(signOkxAccess(secret, timestamp, method, requestPath, body)).toBe(
      expected,
    );
  });

  it("uppercases method before signing", () => {
    const secret = "s";
    const ts = "2026-07-14T00:00:00.000Z";
    const path = "/api/v6/dex/market/token/basic-info";
    const lower = signOkxAccess(secret, ts, "post", path, "[]");
    const upper = signOkxAccess(secret, ts, "POST", path, "[]");
    expect(lower).toBe(upper);
  });

  it("includes body in prehash when present", () => {
    const secret = "s";
    const ts = "2026-07-14T00:00:00.000Z";
    const path = "/api/v6/dex/market/price-info";
    const body = '[{"chainIndex":"196","tokenContractAddress":"0xabc"}]';
    const withBody = signOkxAccess(secret, ts, "POST", path, body);
    const withoutBody = signOkxAccess(secret, ts, "POST", path, "");
    expect(withBody).not.toBe(withoutBody);
  });
});

describe("okxAccessTimestamp", () => {
  it("returns ISO UTC with Z suffix", () => {
    const ts = okxAccessTimestamp(new Date("2026-07-14T13:23:00.123Z"));
    expect(ts).toBe("2026-07-14T13:23:00.123Z");
  });
});

describe("buildOkxAccessHeaders", () => {
  const credentials = {
    apiKey: "REDACTED_OKXOS_KEY",
    secretKey: "REDACTED_OKXOS_SECRET",
    passphrase: "my-passphrase",
  };

  it("emits the four OK-ACCESS headers with matching sign", () => {
    const now = new Date("2026-07-14T13:23:00.000Z");
    const requestPath =
      "/api/v6/dex/balance/all-token-balances-by-address?address=0x1&chains=196";

    const headers = buildOkxAccessHeaders(credentials, "GET", requestPath, "", now);

    expect(headers["OK-ACCESS-KEY"]).toBe(credentials.apiKey);
    expect(headers["OK-ACCESS-PASSPHRASE"]).toBe(credentials.passphrase);
    expect(headers["OK-ACCESS-TIMESTAMP"]).toBe("2026-07-14T13:23:00.000Z");
    expect(headers["OK-ACCESS-SIGN"]).toBe(
      signOkxAccess(
        credentials.secretKey,
        "2026-07-14T13:23:00.000Z",
        "GET",
        requestPath,
        "",
      ),
    );
    expect(headers.Accept).toBe("application/json");
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("sets Content-Type only when a body is present", () => {
    const headers = buildOkxAccessHeaders(
      credentials,
      "POST",
      "/api/v6/dex/market/token/basic-info",
      "[]",
      new Date("2026-07-14T13:23:00.000Z"),
    );
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("getCredentials", () => {
  it("prefers OKXOS_* names", () => {
    const creds = getCredentials({
      OKXOS_API_KEY: "new-key",
      OKXOS_SECRET_KEY: "new-secret",
      OKXOS_PASSPHRASE: "new-pass",
      OKLINK_API_KEY: "old-key",
      OKLINK_SECRET_KEY: "old-secret",
      OKLINK_PASSPHRASE: "old-pass",
    });
    expect(creds.apiKey).toBe("new-key");
    expect(creds.secretKey).toBe("new-secret");
    expect(creds.passphrase).toBe("new-pass");
  });

  it("falls back to legacy OKLINK_* names", () => {
    const creds = getCredentials({
      OKLINK_API_KEY: "old-key",
      OKLINK_SECRET_KEY: "old-secret",
      OKLINK_PASSPHRASE: "old-pass",
    });
    expect(creds.apiKey).toBe("old-key");
  });

  it("throws AuthFailed naming the env vars when missing", () => {
    try {
      getCredentials({});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ChainDataError);
      const e = err as ChainDataError;
      expect(e.kind).toBe("AuthFailed");
      expect(e.message).toContain("OKXOS_API_KEY");
      expect(e.message).toContain("OKXOS_SECRET_KEY");
      expect(e.message).toContain("OKXOS_PASSPHRASE");
    }
  });
});

describe("classifyEnvelopeError", () => {
  it("maps rate limit style messages to RateLimited", () => {
    expect(classifyEnvelopeError("50011", "Request too frequent").kind).toBe(
      "RateLimited",
    );
  });

  it("maps no-data style messages to NotFound", () => {
    expect(classifyEnvelopeError("51000", "No data found").kind).toBe("NotFound");
  });

  it("maps signature style messages to AuthFailed with env hint", () => {
    const err = classifyEnvelopeError("50113", "Invalid Sign");
    expect(err.kind).toBe("AuthFailed");
    expect(err.message).toContain("OKXOS_API_KEY");
  });

  it("defaults to Upstream", () => {
    expect(classifyEnvelopeError("1", "internal service error occurred").kind).toBe(
      "Upstream",
    );
  });
});

describe("mapTx", () => {
  it("normalizes a v6 transaction row", () => {
    const tx = mapTx({
      chainIndex: "196",
      txHash: "0xABCDEF",
      itype: "2",
      methodId: "0xa9059cbb",
      txTime: "1752408000000",
      from: [{ address: "0xFROM", amount: "1" }],
      to: [{ address: "0xTO", amount: "1" }],
      amount: "1.5",
      txStatus: "success",
    });
    expect(tx.hash).toBe("0xABCDEF");
    expect(tx.timestampMs).toBe(1752408000000);
    expect(tx.from).toBe("0xfrom");
    expect(tx.to).toBe("0xto");
    expect(tx.method).toBe("0xa9059cbb");
    expect(tx.value).toBe("1.5");
    expect(tx.status).toBe("success");
  });

  it("labels plain native transfers and maps fail/pending statuses", () => {
    const native = mapTx({ itype: "0", txStatus: "fail", txTime: "1752408000" });
    expect(native.method).toBe("transfer");
    expect(native.status).toBe("failed");
    expect(native.timestampMs).toBe(1752408000000);
    expect(mapTxStatus("pending")).toBe("unknown");
    expect(mapTxStatus(undefined)).toBe("unknown");
  });
});

describe("normalizePercent", () => {
  it("passes through percent-style values", () => {
    expect(normalizePercent("42.5")).toBe(42.5);
  });

  it("expands fraction-style values", () => {
    expect(normalizePercent("0.42")).toBeCloseTo(42, 8);
  });

  it("returns null for missing or bad values", () => {
    expect(normalizePercent(undefined)).toBeNull();
    expect(normalizePercent("")).toBeNull();
    expect(normalizePercent("abc")).toBeNull();
  });
});

describe("mapHolders", () => {
  it("reads address and percent candidates", () => {
    const holders = mapHolders([
      { holderWalletAddress: "0xAAA", holdAmount: "100", holdPercent: "12.5" },
      { walletAddress: "0xBBB", amount: "50", holdPercent: "7.5" },
    ]);
    expect(holders[0]).toEqual({ address: "0xaaa", amount: "100", percentage: 12.5 });
    expect(holders[1]).toEqual({ address: "0xbbb", amount: "50", percentage: 7.5 });
  });

  it("detects fraction convention and converts to percent", () => {
    const holders = mapHolders([
      { address: "0x1", holdPercent: "0.4" },
      { address: "0x2", holdPercent: "0.1" },
    ]);
    expect(holders[0]!.percentage).toBeCloseTo(40, 8);
    expect(holders[1]!.percentage).toBeCloseTo(10, 8);
  });
});

describe("mapTrade", () => {
  it("extracts tx hash from txHashUrl and maps sides", () => {
    const hash = "0x" + "ab".repeat(32);
    const trade = mapTrade({
      id: "123",
      txHashUrl: `https://web3.okx.com/explorer/x-layer/tx/${hash}`,
      userAddress: "0xTRADER",
      type: "BUY",
      changedTokenInfo: { amount: "10", tokenSymbol: "ABC" },
      volume: "12.34",
      time: "1752408000000",
    });
    expect(trade.hash).toBe(hash);
    expect(trade.trader).toBe("0xtrader");
    expect(trade.side).toBe("buy");
    expect(trade.amount).toBe("10");
    expect(trade.volumeUsd).toBeCloseTo(12.34, 8);
  });

  it("falls back to id and unknown side", () => {
    const trade = mapTrade({ id: "trade-9", type: "swap" });
    expect(trade.hash).toBe("trade-9");
    expect(trade.side).toBe("unknown");
  });
});

describe("okxFetch error mapping (via getAddressTransactions)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubEnv(): void {
    vi.stubEnv("OKXOS_API_KEY", "k");
    vi.stubEnv("OKXOS_SECRET_KEY", "s");
    vi.stubEnv("OKXOS_PASSPHRASE", "p");
  }

  it("maps HTTP 401 to AuthFailed naming env vars", async () => {
    stubEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 401 })),
    );
    const { getAddressTransactions } = await import("./chaindata");
    await expect(
      getAddressTransactions("0x401aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ).rejects.toMatchObject({
      name: "ChainDataError",
      kind: "AuthFailed",
      message: expect.stringContaining("OKXOS_API_KEY"),
    });
  });

  it("maps HTTP 402 quota exhaustion to RateLimited", async () => {
    stubEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("payment required", { status: 402 })),
    );
    const { getAddressTransactions } = await import("./chaindata");
    await expect(
      getAddressTransactions("0x402aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ).rejects.toMatchObject({
      kind: "RateLimited",
      message: expect.stringContaining("quota"),
    });
  });

  it("parses a successful envelope into normalized txs", async () => {
    stubEnv();
    const body = {
      code: "0",
      msg: "",
      data: [
        {
          transactions: [
            {
              txHash: "0x1",
              itype: "0",
              txTime: "1752408000000",
              from: [{ address: "0xA" }],
              to: [{ address: "0xB" }],
              amount: "2",
              txStatus: "success",
            },
          ],
          cursor: "",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body)),
    );
    const { getAddressTransactions } = await import("./chaindata");
    const { txs } = await getAddressTransactions(
      "0x200aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      { page: 1, limit: 20 },
    );
    expect(txs).toHaveLength(1);
    expect(txs[0]!.hash).toBe("0x1");
    expect(txs[0]!.from).toBe("0xa");
    expect(txs[0]!.status).toBe("success");
  });
});
