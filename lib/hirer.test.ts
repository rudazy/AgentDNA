import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeEndpoint,
  DaySpendLedger,
  extractPaymentRequired,
  getSpendLimits,
  HirerError,
  microToUsdt,
  parseUsdtToMicro,
  payAndCall,
  selectAcceptsEntry,
  SpendController,
  SPEND_DEFAULTS,
  type HireRequest,
  type PaymentLayer,
} from "./hirer";
import { USDT0_ADDRESS, X_LAYER_NETWORK } from "./constants";

const ENDPOINT = "https://asp.example.com/service";
const PAYEE = "0x1111111111111111111111111111111111111111";

function limits(perSubcall = "0.10", perJob = "0.35", perDay = "5.00") {
  return {
    perSubcallMicro: parseUsdtToMicro(perSubcall)!,
    perJobMicro: parseUsdtToMicro(perJob)!,
    perDayMicro: parseUsdtToMicro(perDay)!,
  };
}

function controller(
  opts: {
    perSubcall?: string;
    perJob?: string;
    perDay?: string;
    budget?: string;
    ledger?: DaySpendLedger;
  } = {},
) {
  const ledger = opts.ledger ?? new DaySpendLedger();
  return new SpendController(
    limits(opts.perSubcall, opts.perJob, opts.perDay),
    ledger,
    opts.budget !== undefined ? parseUsdtToMicro(opts.budget)! : undefined,
  );
}

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

function acceptsEntry(amountAtomic: string, overrides: Record<string, unknown> = {}) {
  return {
    scheme: "exact",
    network: X_LAYER_NETWORK,
    asset: USDT0_ADDRESS,
    amount: amountAtomic,
    payTo: PAYEE,
    maxTimeoutSeconds: 300,
    extra: {},
    ...overrides,
  };
}

function challenge(amountAtomic: string, overrides: Record<string, unknown> = {}) {
  return {
    x402Version: 2,
    resource: { url: ENDPOINT },
    accepts: [acceptsEntry(amountAtomic, overrides)],
  };
}

function response402(amountAtomic: string): Response {
  return new Response("payment required", {
    status: 402,
    headers: { "PAYMENT-REQUIRED": b64(challenge(amountAtomic)) },
  });
}

function response200(
  body: unknown,
  settlement?: { transaction: string; status?: string; success?: boolean },
): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (settlement) {
    headers["PAYMENT-RESPONSE"] = b64({
      success: settlement.success ?? true,
      status: settlement.status ?? "success",
      transaction: settlement.transaction,
      network: X_LAYER_NETWORK,
    });
  }
  return new Response(JSON.stringify(body), { status: 200, headers });
}

function mockPaymentLayer(): PaymentLayer & { calls: number } {
  const layer = {
    calls: 0,
    async createPaymentHeaders() {
      layer.calls += 1;
      return { "PAYMENT-SIGNATURE": "signed-payload" };
    },
  };
  return layer;
}

function hireReq(overrides: Partial<HireRequest> = {}): HireRequest {
  return {
    endpoint: ENDPOINT,
    priceUsdt0: "0.05",
    body: { input: "x" },
    serviceName: "Test Service",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseUsdtToMicro / microToUsdt", () => {
  it("parses whole and fractional amounts", () => {
    expect(parseUsdtToMicro("0.10")).toBe(100000n);
    expect(parseUsdtToMicro("5")).toBe(5000000n);
    expect(parseUsdtToMicro("0.000001")).toBe(1n);
    expect(parseUsdtToMicro("12.345678")).toBe(12345678n);
  });

  it("rejects malformed amounts", () => {
    expect(parseUsdtToMicro("")).toBeNull();
    expect(parseUsdtToMicro("-1")).toBeNull();
    expect(parseUsdtToMicro("1.2345678")).toBeNull();
    expect(parseUsdtToMicro("abc")).toBeNull();
    expect(parseUsdtToMicro("1,5")).toBeNull();
    expect(parseUsdtToMicro("$0.05")).toBeNull();
  });

  it("round-trips through microToUsdt", () => {
    expect(microToUsdt(100000n)).toBe("0.1");
    expect(microToUsdt(5000000n)).toBe("5");
    expect(microToUsdt(12345678n)).toBe("12.345678");
    expect(microToUsdt(0n)).toBe("0");
  });
});

describe("getSpendLimits", () => {
  it("uses safe defaults when env is empty", () => {
    const l = getSpendLimits({});
    expect(microToUsdt(l.perSubcallMicro)).toBe("0.1");
    expect(microToUsdt(l.perJobMicro)).toBe("0.35");
    expect(microToUsdt(l.perDayMicro)).toBe("5");
    expect(SPEND_DEFAULTS.perSubcall).toBe("0.10");
  });

  it("reads env overrides", () => {
    const l = getSpendLimits({
      MAX_SPEND_PER_SUBCALL: "0.25",
      MAX_SPEND_PER_JOB: "1.00",
      MAX_SPEND_PER_DAY: "10",
    });
    expect(l.perSubcallMicro).toBe(250000n);
    expect(l.perJobMicro).toBe(1000000n);
    expect(l.perDayMicro).toBe(10000000n);
  });

  it("fails fast on malformed env values", () => {
    expect(() => getSpendLimits({ MAX_SPEND_PER_JOB: "lots" })).toThrowError(
      HirerError,
    );
    try {
      getSpendLimits({ MAX_SPEND_PER_JOB: "lots" });
    } catch (err) {
      expect((err as HirerError).kind).toBe("Config");
    }
  });
});

describe("DaySpendLedger", () => {
  it("accumulates within a day and resets on UTC rollover", () => {
    let nowIso = "2026-07-17T10:00:00.000Z";
    const ledger = new DaySpendLedger(() => new Date(nowIso));
    ledger.add(100n);
    ledger.add(50n);
    expect(ledger.spent).toBe(150n);
    nowIso = "2026-07-18T00:00:01.000Z";
    expect(ledger.spent).toBe(0n);
  });

  it("never goes negative on subtract", () => {
    const ledger = new DaySpendLedger();
    ledger.add(10n);
    ledger.subtract(100n);
    expect(ledger.spent).toBe(0n);
  });
});

describe("SpendController", () => {
  it("allows amounts exactly at the subcall cap and refuses one micro above", () => {
    const c = controller();
    expect(c.check(100000n).ok).toBe(true);
    const refusal = c.check(100001n);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.scope).toBe("subcall");
  });

  it("refuses zero and negative amounts", () => {
    const c = controller();
    expect(c.check(0n).ok).toBe(false);
    expect(c.check(-5n).ok).toBe(false);
  });

  it("enforces the per-job cap cumulatively", () => {
    const c = controller();
    expect(c.reserve(100000n).ok).toBe(true);
    expect(c.reserve(100000n).ok).toBe(true);
    expect(c.reserve(100000n).ok).toBe(true);
    const refusal = c.reserve(100000n);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.scope).toBe("job");
    expect(c.jobSpent).toBe(300000n);
  });

  it("caps the job at the caller budget when smaller than MAX_SPEND_PER_JOB", () => {
    const c = controller({ budget: "0.15" });
    expect(c.jobCapMicro).toBe(150000n);
    expect(c.reserve(100000n).ok).toBe(true);
    const refusal = c.reserve(100000n);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.scope).toBe("job");
  });

  it("ignores a caller budget larger than MAX_SPEND_PER_JOB", () => {
    const c = controller({ budget: "100" });
    expect(c.jobCapMicro).toBe(350000n);
  });

  it("enforces the per-day cap across jobs sharing a ledger", () => {
    const ledger = new DaySpendLedger();
    const a = controller({ perDay: "0.15", ledger });
    const b = controller({ perDay: "0.15", ledger });
    expect(a.reserve(100000n).ok).toBe(true);
    const refusal = b.reserve(100000n);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.scope).toBe("day");
  });

  it("release restores both job and day headroom", () => {
    const ledger = new DaySpendLedger();
    const c = controller({ ledger });
    expect(c.reserve(100000n).ok).toBe(true);
    c.release(100000n);
    expect(c.jobSpent).toBe(0n);
    expect(ledger.spent).toBe(0n);
    expect(c.reserve(100000n).ok).toBe(true);
  });
});

describe("assertSafeEndpoint", () => {
  it("accepts public https endpoints", () => {
    expect(assertSafeEndpoint("https://asp.example.com/x").hostname).toBe(
      "asp.example.com",
    );
  });

  it.each([
    "http://asp.example.com/x",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://10.1.2.3/x",
    "https://192.168.1.1/x",
    "https://172.16.0.1/x",
    "https://foo.internal/x",
    "not-a-url",
  ])("refuses %s", (endpoint) => {
    expect(() => assertSafeEndpoint(endpoint)).toThrowError(HirerError);
  });
});

describe("selectAcceptsEntry", () => {
  it("picks the cheapest compatible entry", () => {
    const pr = {
      x402Version: 2,
      resource: { url: ENDPOINT },
      accepts: [acceptsEntry("70000"), acceptsEntry("50000")],
    };
    expect(selectAcceptsEntry(pr as never).amountAtomic).toBe(50000n);
  });

  it("skips wrong scheme, network, and asset", () => {
    const pr = {
      x402Version: 2,
      resource: { url: ENDPOINT },
      accepts: [
        acceptsEntry("50000", { scheme: "upto" }),
        acceptsEntry("50000", { network: "eip155:1" }),
        acceptsEntry("50000", { asset: "0x2222222222222222222222222222222222222222" }),
      ],
    };
    expect(() => selectAcceptsEntry(pr as never)).toThrowError(HirerError);
  });

  it("tolerates v1 maxAmountRequired and dollar price strings", () => {
    const viaMax = {
      x402Version: 1,
      resource: { url: ENDPOINT },
      accepts: [acceptsEntry("", { amount: undefined, maxAmountRequired: "50000" })],
    };
    expect(selectAcceptsEntry(viaMax as never).amountAtomic).toBe(50000n);

    const viaPrice = {
      x402Version: 1,
      resource: { url: ENDPOINT },
      accepts: [acceptsEntry("", { amount: undefined, price: "$0.05" })],
    };
    expect(selectAcceptsEntry(viaPrice as never).amountAtomic).toBe(50000n);
  });
});

describe("extractPaymentRequired", () => {
  it("prefers the v2 header", async () => {
    const pr = await extractPaymentRequired(response402("50000"), ENDPOINT);
    expect(pr.accepts).toHaveLength(1);
  });

  it("falls back to a v1 JSON body", async () => {
    const res = new Response(JSON.stringify(challenge("50000")), { status: 402 });
    const pr = await extractPaymentRequired(res, ENDPOINT);
    expect(pr.accepts).toHaveLength(1);
  });

  it("rejects a 402 with neither header nor x402 body", async () => {
    const res = new Response(JSON.stringify({ error: "pay up" }), { status: 402 });
    await expect(extractPaymentRequired(res, ENDPOINT)).rejects.toThrowError(
      HirerError,
    );
  });
});

describe("payAndCall", () => {
  it("dry run short-circuits before any network or spend activity", async () => {
    vi.stubEnv("FOREMAN_DRY_RUN", "true");
    const fetchImpl = vi.fn();
    const spend = controller();
    const outcome = await payAndCall(hireReq(), spend, {
      fetchImpl: fetchImpl as never,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(outcome.receipt.dryRun).toBe(true);
    expect(outcome.receipt.settlementStatus).toBe("dry_run");
    expect(outcome.receipt.txHash).toBeNull();
    expect(spend.jobSpent).toBe(0n);
  });

  it("pays a 402 challenge and returns a settlement receipt", async () => {
    const layer = mockPaymentLayer();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response402("50000"))
      .mockResolvedValueOnce(
        response200({ verdict: "ok" }, { transaction: "0xabc" }),
      );
    const spend = controller();
    const outcome = await payAndCall(hireReq(), spend, {
      fetchImpl: fetchImpl as never,
      paymentLayer: layer,
    });
    expect(layer.calls).toBe(1);
    expect(outcome.result).toEqual({ verdict: "ok" });
    expect(outcome.receipt.txHash).toBe("0xabc");
    expect(outcome.receipt.payee).toBe(PAYEE);
    expect(outcome.receipt.amountUsdt0).toBe("0.05");
    expect(outcome.receipt.settlementStatus).toBe("success");
    expect(spend.jobSpent).toBe(50000n);
    const paidCall = fetchImpl.mock.calls[1]![1] as RequestInit;
    expect(
      (paidCall.headers as Record<string, string>)["PAYMENT-SIGNATURE"],
    ).toBe("signed-payload");
  });

  it("returns a free receipt when the service answers 200 without payment", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response200({ data: 1 }));
    const spend = controller();
    const outcome = await payAndCall(hireReq(), spend, {
      fetchImpl: fetchImpl as never,
      paymentLayer: mockPaymentLayer(),
    });
    expect(outcome.receipt.settlementStatus).toBe("free");
    expect(outcome.receipt.amountAtomic).toBe("0");
    expect(spend.jobSpent).toBe(0n);
  });

  it("refuses before any network call when the quote exceeds the subcall cap", async () => {
    const fetchImpl = vi.fn();
    const spend = controller();
    await expect(
      payAndCall(hireReq({ priceUsdt0: "0.20" }), spend, {
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ kind: "SpendLimit" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts on a job cap breach without paying", async () => {
    const spend = controller({ budget: "0.04" });
    const fetchImpl = vi.fn();
    await expect(
      payAndCall(hireReq(), spend, { fetchImpl: fetchImpl as never }),
    ).rejects.toMatchObject({ kind: "SpendLimit" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts on a day cap breach without paying", async () => {
    const ledger = new DaySpendLedger();
    ledger.add(parseUsdtToMicro("4.98")!);
    const spend = controller({ ledger });
    const fetchImpl = vi.fn();
    await expect(
      payAndCall(hireReq(), spend, { fetchImpl: fetchImpl as never }),
    ).rejects.toMatchObject({ kind: "SpendLimit" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to pay a challenge above the registry quote", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response402("60000"));
    const layer = mockPaymentLayer();
    const spend = controller();
    await expect(
      payAndCall(hireReq(), spend, {
        fetchImpl: fetchImpl as never,
        paymentLayer: layer,
      }),
    ).rejects.toMatchObject({ kind: "PriceMismatch" });
    expect(layer.calls).toBe(0);
    expect(spend.jobSpent).toBe(0n);
  });

  it("pays the challenge amount when it is below the quote", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response402("10000"))
      .mockResolvedValueOnce(response200({ ok: 1 }, { transaction: "0xdef" }));
    const spend = controller();
    const outcome = await payAndCall(hireReq(), spend, {
      fetchImpl: fetchImpl as never,
      paymentLayer: mockPaymentLayer(),
    });
    expect(outcome.receipt.amountUsdt0).toBe("0.01");
    expect(spend.jobSpent).toBe(10000n);
  });

  it("releases the reservation when signing fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response402("50000"));
    const failingLayer: PaymentLayer = {
      async createPaymentHeaders() {
        throw new Error("key locked");
      },
    };
    const spend = controller();
    await expect(
      payAndCall(hireReq(), spend, {
        fetchImpl: fetchImpl as never,
        paymentLayer: failingLayer,
      }),
    ).rejects.toMatchObject({ kind: "PaymentFailed" });
    expect(spend.jobSpent).toBe(0n);
  });

  it("keeps the spend committed when the service fails after payment was sent", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response402("50000"))
      .mockResolvedValueOnce(new Response("boom", { status: 400 }));
    const spend = controller();
    await expect(
      payAndCall(hireReq(), spend, {
        fetchImpl: fetchImpl as never,
        paymentLayer: mockPaymentLayer(),
      }),
    ).rejects.toMatchObject({ kind: "ServiceFailed" });
    expect(spend.jobSpent).toBe(50000n);
  });

  it("maps a 402 after payment to PaymentFailed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response402("50000"))
      .mockResolvedValueOnce(response402("50000"));
    const spend = controller();
    await expect(
      payAndCall(hireReq(), spend, {
        fetchImpl: fetchImpl as never,
        paymentLayer: mockPaymentLayer(),
      }),
    ).rejects.toMatchObject({ kind: "PaymentFailed" });
  });

  it("retries once on a transient 5xx and succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("flaky", { status: 503 }))
      .mockResolvedValueOnce(response402("50000"))
      .mockResolvedValueOnce(response200({ ok: 1 }, { transaction: "0x1" }));
    const spend = controller();
    const outcome = await payAndCall(hireReq(), spend, {
      fetchImpl: fetchImpl as never,
      paymentLayer: mockPaymentLayer(),
    });
    expect(outcome.receipt.txHash).toBe("0x1");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails with ServiceFailed after two consecutive 5xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("down", { status: 500 }));
    const spend = controller();
    await expect(
      payAndCall(hireReq(), spend, { fetchImpl: fetchImpl as never }),
    ).rejects.toMatchObject({ kind: "ServiceFailed" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps a non-402 error status to ServiceFailed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 404 }));
    const spend = controller();
    await expect(
      payAndCall(hireReq(), spend, { fetchImpl: fetchImpl as never }),
    ).rejects.toMatchObject({ kind: "ServiceFailed", status: 404 });
  });

  it("rejects malformed registry prices as Config errors", async () => {
    const spend = controller();
    await expect(
      payAndCall(hireReq({ priceUsdt0: "$0.05" }), spend, {
        fetchImpl: vi.fn() as never,
      }),
    ).rejects.toMatchObject({ kind: "Config" });
  });

  it("appends query params for GET-style services", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response402("50000"))
      .mockResolvedValueOnce(response200({ ok: 1 }, { transaction: "0x2" }));
    const spend = controller();
    await payAndCall(
      hireReq({
        method: "GET",
        body: undefined,
        query: { address: "0xabc", chain: "ethereum" },
      }),
      spend,
      { fetchImpl: fetchImpl as never, paymentLayer: mockPaymentLayer() },
    );
    const calledUrl = fetchImpl.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("address=0xabc");
    expect(calledUrl).toContain("chain=ethereum");
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).method).toBe("GET");
  });
});
