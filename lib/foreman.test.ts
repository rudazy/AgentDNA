import { describe, expect, it, vi } from "vitest";
import {
  buildPlan,
  CAPABILITIES,
  DISPATCH_PRICE_USDT0,
  ForemanError,
  forcedDryRunDeps,
  loadRegistry,
  runDispatch,
  type DispatchContext,
  type ForemanDeps,
  type Subcontractor,
} from "./foreman";
import {
  DaySpendLedger,
  HirerError,
  parseUsdtToMicro,
  type HireOutcome,
} from "./hirer";
import type { AgentScanResponse, TokenScanResponse } from "./types";

const AGENT_ADDR = "0x00000000000000000000000000000000000000A1";
const TOKEN_ADDR = "0x00000000000000000000000000000000000000B2";

function limits(perSubcall = "0.10", perJob = "0.35", perDay = "5.00") {
  return {
    perSubcallMicro: parseUsdtToMicro(perSubcall)!,
    perJobMicro: parseUsdtToMicro(perJob)!,
    perDayMicro: parseUsdtToMicro(perDay)!,
  };
}

function agentScan(grade: AgentScanResponse["grade"] = "B"): AgentScanResponse {
  return {
    service: "agent-dna",
    scan: "agent",
    address: AGENT_ADDR,
    grade,
    traits: {
      reliability: 80,
      consistency: 70,
      longevity: 50,
      riskAppetite: 30,
      activity: 60,
      counterpartyDiversity: 55,
    },
    deliveryProbability: 74,
    deliveryProbabilityLabel: "heuristic estimate",
    confidence: 62,
    explanation: "test",
    scannedAt: "2026-07-17T00:00:00.000Z",
    version: "1.0.0",
  };
}

function tokenScan(): TokenScanResponse {
  return {
    service: "agent-dna",
    scan: "token",
    address: TOKEN_ADDR,
    score: 71,
    riskLevel: "MEDIUM",
    flags: ["Contract verification status unavailable on this data source; trust signal limited"],
    confidence: 55,
    explanation: "test",
    scannedAt: "2026-07-17T00:00:00.000Z",
    version: "1.0.0",
  };
}

function hireOutcome(amount = "0.001", tx = "0xhash"): HireOutcome {
  return {
    result: { verdict: "looks fine" },
    receipt: {
      endpoint: "https://example.com",
      payee: "0x1111111111111111111111111111111111111111",
      amountUsdt0: amount,
      amountAtomic: (parseUsdtToMicro(amount) ?? 0n).toString(),
      txHash: tx,
      settlementStatus: "success",
      paidAt: "2026-07-17T00:00:00.000Z",
      durationMs: 100,
      dryRun: false,
    },
  };
}

function deps(overrides: Partial<ForemanDeps> = {}): ForemanDeps {
  return {
    limits: limits(),
    dayLedger: new DaySpendLedger(),
    payAndCall: vi.fn().mockResolvedValue(hireOutcome()),
    runAgentScan: vi.fn().mockResolvedValue(agentScan()),
    runTokenScan: vi.fn().mockResolvedValue(tokenScan()),
    registry: loadRegistry(),
    dryRun: false,
    now: () => new Date("2026-07-17T12:00:00.000Z"),
    ...overrides,
  };
}

function plan(goal: string, context: DispatchContext = {}, registry?: Subcontractor[]) {
  return buildPlan(
    goal,
    context,
    limits(),
    parseUsdtToMicro("0.35")!,
    registry ?? loadRegistry(),
  );
}

describe("loadRegistry", () => {
  it("loads the shipped registry", () => {
    const registry = loadRegistry();
    expect(registry.length).toBeGreaterThanOrEqual(4);
    expect(registry.every((s) => s.endpoint.startsWith("https://"))).toBe(true);
  });

  it("drops malformed entries", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = loadRegistry({
      subcontractors: [
        { id: "bad", endpoint: "http://insecure.example.com" },
        loadRegistry()[0],
      ],
    });
    expect(registry).toHaveLength(1);
    spy.mockRestore();
  });

  it("returns empty on garbage input", () => {
    expect(loadRegistry(null)).toEqual([]);
    expect(loadRegistry({})).toEqual([]);
  });
});

describe("buildPlan taxonomy routing", () => {
  it("routes counterparty due diligence in house", () => {
    const p = plan(`Run due diligence on agent ${AGENT_ADDR}`);
    expect(p.subtasks).toHaveLength(1);
    expect(p.subtasks[0]!.kind).toBe("counterparty_diligence");
    expect(p.subtasks[0]!.route).toBe("in_house");
    expect(p.subtasks[0]!.targetAddress).toBe(AGENT_ADDR);
  });

  it("routes an X Layer token risk check in house when no chain is named", () => {
    const p = plan(`Is this token safe? ${TOKEN_ADDR}`);
    expect(p.subtasks[0]!.kind).toBe("token_risk");
    expect(p.subtasks[0]!.route).toBe("in_house");
  });

  it("routes token risk to the external ASP when a supported chain is named", () => {
    const p = plan(`Check this token for honeypot risk`, {
      tokenAddress: TOKEN_ADDR,
      chain: "ethereum",
    });
    expect(p.subtasks[0]!.route).toBe("external");
    expect(p.subtasks[0]!.subcontractorId).toBe("chainsentry-token-dd");
  });

  it("routes prediction market goals to the cheapest external within caps", () => {
    const p = plan("What are the odds Polymarket resolves YES on the election market?");
    expect(p.subtasks[0]!.kind).toBe("prediction_market");
    expect(p.subtasks[0]!.route).toBe("external");
    expect(p.subtasks[0]!.subcontractorId).toBe("prex-market-analysis");
  });

  it("refuses with 422 when the only odds ASP exceeds the per-subcall cap", () => {
    const registry = loadRegistry().filter((s) => s.id !== "prex-market-analysis");
    expect(() =>
      plan("Give me a prediction market brief on the election", {}, registry),
    ).toThrowError(ForemanError);
  });

  it("notes the over-cap odds ASP while the rest of a composite plan survives", () => {
    const registry = loadRegistry().filter((s) => s.id !== "prex-market-analysis");
    const p = plan(
      `Prediction market brief on the election and due diligence on ${AGENT_ADDR}`,
      {},
      registry,
    );
    expect(p.notes.some((n) => n.includes("per-subcall cap"))).toBe(true);
    const prediction = p.subtasks.find((s) => s.kind === "prediction_market")!;
    expect(prediction.route).toBe("unroutable");
    const dd = p.subtasks.find((s) => s.kind === "counterparty_diligence")!;
    expect(dd.route).toBe("in_house");
  });

  it("routes security checks to the external security ASP", () => {
    const p = plan(`Run a security audit on ${TOKEN_ADDR}`);
    expect(p.subtasks[0]!.kind).toBe("security_check");
    expect(p.subtasks[0]!.route).toBe("external");
    expect(p.subtasks[0]!.subcontractorId).toBe("certik-security");
  });

  it("splits a composite goal into parallel subtasks", () => {
    const p = plan(
      `Check the odds on Polymarket for the fed decision, vet counterparty ${AGENT_ADDR}, and scan token ${TOKEN_ADDR} for risk`,
    );
    const kinds = p.subtasks.map((s) => s.kind).sort();
    expect(kinds).toEqual([
      "counterparty_diligence",
      "prediction_market",
      "token_risk",
    ]);
  });

  it("marks a required-address subtask unroutable when no address is available", () => {
    const p = plan(
      "Vet the counterparty for me and give me polymarket odds on the game",
    );
    const dd = p.subtasks.find((s) => s.kind === "counterparty_diligence")!;
    expect(dd.route).toBe("unroutable");
    expect(dd.rationale).toContain("Provide it");
  });

  it("falls back in house when the security ASP exceeds the caps", () => {
    const registry = loadRegistry().map((s) =>
      s.id === "certik-security" ? { ...s, priceUsdt0: "0.50" } : s,
    );
    const p = plan(`Audit contract ${TOKEN_ADDR}`, {}, registry);
    expect(p.subtasks[0]!.route).toBe("in_house");
    expect(p.notes.some((n) => n.includes("per-subcall cap"))).toBe(true);
  });

  it("throws 422 with the capability list for unresolvable goals", () => {
    try {
      plan("Write me a poem about lighthouses");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ForemanError);
      const fe = err as ForemanError;
      expect(fe.status).toBe(422);
      expect(fe.code).toBe("UNRESOLVABLE");
      expect(fe.details).toEqual([...CAPABILITIES]);
    }
  });

  it("throws 422 when every matched subtask is unroutable", () => {
    expect(() => plan("Run due diligence on my counterparty")).toThrowError(
      ForemanError,
    );
  });
});

describe("runDispatch", () => {
  it("rejects a missing goal with 400", async () => {
    await expect(
      runDispatch({ goal: "  " }, deps()),
    ).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
  });

  it("rejects an over-long goal with 400", async () => {
    await expect(
      runDispatch({ goal: "odds ".repeat(600) }, deps()),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a non-positive budget with 400", async () => {
    await expect(
      runDispatch({ goal: "polymarket odds", budget: -1 }, deps()),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("runs an in-house counterparty job end to end with no receipts", async () => {
    const d = deps();
    const res = await runDispatch(
      { goal: `Due diligence on agent ${AGENT_ADDR}` },
      d,
    );
    expect(res.scan).toBe("dispatch");
    expect(res.results[0]!.status).toBe("ok");
    expect(res.results[0]!.summary).toContain("grades B");
    expect(res.receipts).toHaveLength(0);
    expect(res.totalPaid).toBe("0");
    expect(res.margin).toBe("0.5");
    expect(d.payAndCall).not.toHaveBeenCalled();
  });

  it("hires an external ASP and returns a complete receipt", async () => {
    const d = deps();
    const res = await runDispatch(
      { goal: "What are the polymarket odds on the fed cutting rates?" },
      d,
    );
    expect(res.receipts).toHaveLength(1);
    const receipt = res.receipts[0]!;
    expect(receipt.subcontractor).toContain("Prex");
    expect(receipt.endpoint).toBe("https://prex.best/api/okx-ai/market-analysis");
    expect(receipt.amountUsdt0).toBe("0.001");
    expect(receipt.txHash).toBe("0xhash");
    expect(receipt.settlementStatus).toBe("success");
    expect(receipt.trustCheck?.status).toBe("passed");
    expect(receipt.durationMs).toBeGreaterThanOrEqual(0);
    expect(res.totalPaid).toBe("0.001");
    expect(res.margin).toBe("0.499");
    expect(DISPATCH_PRICE_USDT0).toBe("0.50");
  });

  it("runs the hiring standard on the payee before paying", async () => {
    const d = deps();
    await runDispatch({ goal: "polymarket odds please" }, d);
    expect(d.runAgentScan).toHaveBeenCalledWith(
      "0xCf3B07Eb8C4910D83F8279ca19e0495eab2AC4D4",
    );
    const scanOrder = (d.runAgentScan as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    const payOrder = (d.payAndCall as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(scanOrder).toBeLessThan(payOrder);
  });

  it("does not hire a blocked subcontractor and falls back in house", async () => {
    const d = deps({
      runAgentScan: vi.fn().mockResolvedValue(agentScan("F")),
    });
    const res = await runDispatch(
      { goal: `Run a security audit on contract ${TOKEN_ADDR}` },
      d,
    );
    expect(d.payAndCall).not.toHaveBeenCalled();
    expect(res.receipts).toHaveLength(0);
    expect(res.results[0]!.provider).toContain("in-house fallback");
    expect(res.plan.notes.some((n) => n.includes("not hired"))).toBe(true);
  });

  it("fails the subtask honestly when a blocked hire has no fallback", async () => {
    const d = deps({
      runAgentScan: vi.fn().mockResolvedValue(agentScan("F")),
    });
    const res = await runDispatch({ goal: "polymarket odds on the game" }, d);
    expect(res.results[0]!.status).toBe("failed");
    expect(res.results[0]!.summary).toContain("not hired");
  });

  it("falls back in house when the external hire fails at runtime", async () => {
    const d = deps({
      payAndCall: vi
        .fn()
        .mockRejectedValue(new HirerError("endpoint down", "ServiceFailed", 503)),
    });
    const res = await runDispatch(
      { goal: `Security audit of ${TOKEN_ADDR}` },
      d,
    );
    expect(res.results[0]!.status).toBe("ok");
    expect(res.results[0]!.provider).toContain("in-house fallback");
    expect(res.plan.notes.some((n) => n.includes("hire failed"))).toBe(true);
    expect(res.receipts).toHaveLength(0);
  });

  it("aborts the whole job on a runtime spend limit breach", async () => {
    const d = deps({
      payAndCall: vi
        .fn()
        .mockRejectedValue(new HirerError("day cap", "SpendLimit")),
    });
    await expect(
      runDispatch({ goal: "polymarket odds on rates" }, d),
    ).rejects.toMatchObject({ status: 409, code: "SPEND_LIMIT" });
  });

  it("marks the prediction subtask unroutable under a tiny budget instead of overspending", async () => {
    const d = deps();
    const res = await runDispatch(
      {
        goal: `Polymarket odds on rates and due diligence on ${AGENT_ADDR}`,
        budget: 0.0001,
      },
      d,
    );
    const prediction = res.results.find((r) => r.kind === "prediction_market")!;
    expect(prediction.status).toBe("skipped");
    expect(d.payAndCall).not.toHaveBeenCalled();
    const dd = res.results.find((r) => r.kind === "counterparty_diligence")!;
    expect(dd.status).toBe("ok");
  });

  it("keeps partial results when one in-house scan fails", async () => {
    const d = deps({
      runTokenScan: vi.fn().mockRejectedValue(new Error("upstream down")),
    });
    const res = await runDispatch(
      {
        goal: `Scan token ${TOKEN_ADDR} for risk and vet agent ${AGENT_ADDR}`,
      },
      d,
    );
    const token = res.results.find((r) => r.kind === "token_risk")!;
    const dd = res.results.find((r) => r.kind === "counterparty_diligence")!;
    expect(token.status).toBe("failed");
    expect(dd.status).toBe("ok");
  });

  it("skips the live trust check in dry run and flags the response", async () => {
    const dryOutcome: HireOutcome = {
      result: { dryRun: true, note: "Dry run" },
      receipt: {
        endpoint: "https://prex.best/api/okx-ai/market-analysis",
        payee: null,
        amountUsdt0: "0.01",
        amountAtomic: "10000",
        txHash: null,
        settlementStatus: "dry_run",
        paidAt: "2026-07-17T00:00:00.000Z",
        durationMs: 0,
        dryRun: true,
      },
    };
    const d = deps({
      dryRun: true,
      payAndCall: vi.fn().mockResolvedValue(dryOutcome),
    });
    const res = await runDispatch({ goal: "polymarket odds on rates" }, d);
    expect(res.dryRun).toBe(true);
    expect(d.runAgentScan).not.toHaveBeenCalled();
    expect(res.receipts[0]!.dryRun).toBe(true);
    expect(res.receipts[0]!.trustCheck?.note).toContain("Dry run");
    expect(res.explanation).toContain("nothing was paid");
  });

  it("forcedDryRunDeps never touches the real payment path", async () => {
    const realPay = vi.fn();
    const d = { ...deps({ payAndCall: realPay }), ...forcedDryRunDeps() };
    const res = await runDispatch({ goal: "polymarket odds on rates" }, d);
    expect(realPay).not.toHaveBeenCalled();
    expect(res.dryRun).toBe(true);
    expect(res.receipts[0]!.settlementStatus).toBe("dry_run");
    expect(res.receipts[0]!.txHash).toBeNull();
  });

  it("reuses the cached trust check for repeated payees in one job", async () => {
    const registry = loadRegistry();
    const prex = registry.find((s) => s.id === "prex-market-analysis")!;
    const doubled = [
      ...registry,
      { ...prex, id: "prex-clone", capability: "security_check" as const },
    ];
    const d = deps({ registry: doubled });
    await runDispatch(
      { goal: `polymarket odds and a security audit of ${TOKEN_ADDR}` },
      d,
    );
    const trustScans = (d.runAgentScan as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => (c[0] as string).toLowerCase())
      .filter((a) => a === prex.payeeAddress.toLowerCase());
    expect(trustScans.length).toBeLessThanOrEqual(1);
  });
});
