import { describe, expect, it } from "vitest";
import {
  buildTokenExplanation,
  buildTokenFlags,
  computeTokenScan,
  computeTokenScore,
  riskLevelFromScore,
  scoreHolderConcentration,
  scoreSupplyMechanics,
  scoreTokenAge,
  scoreTradePatterns,
  scoreTrustSignals,
  TOKEN_SCORE_WEIGHTS,
} from "./tokenscan";
import type { TokenHolder, TokenInfo, TokenTrade } from "./types";

const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const DAY = 86_400_000;
const TOKEN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function tokenInfo(partial: Partial<TokenInfo> = {}): TokenInfo {
  return {
    address: TOKEN,
    name: "Token",
    symbol: "TKN",
    totalSupply: "1000000",
    decimals: 18,
    creationTimeMs: NOW - 100 * DAY,
    communityRecognized: false,
    riskControlLevel: null,
    honeypot: false,
    top10HoldPercent: null,
    devHoldPercent: null,
    holderCount: 100,
    ...partial,
  };
}

function trade(partial: Partial<TokenTrade> = {}): TokenTrade {
  return {
    hash: partial.hash ?? "0x1",
    timestampMs: partial.timestampMs ?? NOW - DAY,
    trader: partial.trader ?? "0xtrader",
    side: partial.side ?? "buy",
    amount: partial.amount ?? "1",
    volumeUsd: partial.volumeUsd ?? 10,
  };
}

describe("TOKEN_SCORE_WEIGHTS", () => {
  it("sums to 1", () => {
    const sum = Object.values(TOKEN_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 8);
  });
});

describe("trust signals", () => {
  it("zeroes on honeypot tag", () => {
    expect(scoreTrustSignals(tokenInfo({ honeypot: true }))).toBe(0);
  });

  it("rewards low risk control level and community recognition", () => {
    const low = scoreTrustSignals(tokenInfo({ riskControlLevel: 1 }));
    const high = scoreTrustSignals(tokenInfo({ riskControlLevel: 5 }));
    const unknown = scoreTrustSignals(tokenInfo({ riskControlLevel: null }));
    const recognized = scoreTrustSignals(
      tokenInfo({ riskControlLevel: null, communityRecognized: true }),
    );
    expect(low).toBeGreaterThan(unknown);
    expect(unknown).toBeGreaterThan(high);
    expect(recognized).toBeGreaterThan(unknown);
  });
});

describe("risky new token", () => {
  it("flags and scores as high risk", () => {
    const info = tokenInfo({
      name: "Risky",
      symbol: "RISK",
      creationTimeMs: NOW - 2 * DAY,
      riskControlLevel: 4,
    });
    const holders: TokenHolder[] = [
      { address: "0x1", amount: "900000", percentage: 90 },
      { address: "0x2", amount: "50000", percentage: 5 },
      { address: "0x3", amount: "50000", percentage: 5 },
    ];
    const trades: TokenTrade[] = [
      trade({ trader: "0x1", side: "sell" }),
      trade({ trader: "0x1", side: "sell" }),
      trade({ trader: "0x1", side: "sell" }),
    ];
    const result = computeTokenScan(TOKEN, info, holders, trades, NOW);
    expect(result.score).toBeLessThan(50);
    expect(["HIGH", "CRITICAL"]).toContain(result.riskLevel);
    expect(result.flags.some((f) => /risk control level is high/i.test(f))).toBe(true);
    expect(result.flags.some((f) => /less than 7 days/i.test(f))).toBe(true);
    expect(result.flags.some((f) => /single trader/i.test(f))).toBe(true);
    expect(result.explanation).not.toMatch(/\u2014/);
  });
});

describe("high holder concentration", () => {
  it("scores top10 over 70 percent as a red flag", () => {
    const holders: TokenHolder[] = Array.from({ length: 10 }, (_, i) => ({
      address: `0x${i}`,
      amount: "8",
      percentage: 8,
    }));
    // 10 * 8 = 80%
    const { score, top10Pct, hasData } = scoreHolderConcentration(holders);
    expect(hasData).toBe(true);
    expect(top10Pct).toBeCloseTo(80, 5);
    expect(score).toBeLessThan(40);

    const flags = buildTokenFlags({
      info: tokenInfo({ riskControlLevel: 1 }),
      top10Pct,
      holderDataAvailable: true,
      ageScore: 80,
      trade: scoreTradePatterns([]),
      tradeCount: 0,
      mintConcentration: 0.2,
      nowMs: NOW,
    });
    expect(flags.some((f) => /70 percent/i.test(f))).toBe(true);
  });

  it("falls back to source top10 percent when holder list is empty", () => {
    const withSource = scoreHolderConcentration([], 85);
    expect(withSource.hasData).toBe(true);
    expect(withSource.top10Pct).toBe(85);
    expect(withSource.score).toBeLessThan(20);

    const withoutAny = scoreHolderConcentration([], null);
    expect(withoutAny.hasData).toBe(false);
    expect(withoutAny.score).toBe(40);
  });

  it("flags missing holder data as a data gap", () => {
    const flags = buildTokenFlags({
      info: tokenInfo({ riskControlLevel: 1 }),
      top10Pct: 0,
      holderDataAvailable: false,
      ageScore: 80,
      trade: scoreTradePatterns([]),
      tradeCount: 0,
      mintConcentration: 0,
      nowMs: NOW,
    });
    expect(
      flags.some((f) => /holder distribution unavailable/i.test(f)),
    ).toBe(true);
  });
});

describe("trade patterns", () => {
  it("penalizes one-sided flow from few traders", () => {
    const oneSided: TokenTrade[] = Array.from({ length: 12 }, (_, i) =>
      trade({
        hash: `0x${i}`,
        trader: i % 2 === 0 ? "0xa" : "0xb",
        side: "sell",
        timestampMs: NOW - i * DAY,
      }),
    );
    const balanced: TokenTrade[] = Array.from({ length: 12 }, (_, i) =>
      trade({
        hash: `0x${i}`,
        trader: `0xtrader${i}`,
        side: i % 2 === 0 ? "buy" : "sell",
        timestampMs: NOW - i * DAY,
      }),
    );
    const a = scoreTradePatterns(oneSided);
    const b = scoreTradePatterns(balanced);
    expect(a.oneSidedRatio).toBe(1);
    expect(b.oneSidedRatio).toBe(0);
    expect(a.score).toBeLessThan(b.score);
  });

  it("penalizes a single dominant trader", () => {
    const dominated: TokenTrade[] = Array.from({ length: 10 }, (_, i) =>
      trade({ hash: `0x${i}`, trader: "0xwhale", side: i % 2 ? "buy" : "sell" }),
    );
    const spread: TokenTrade[] = Array.from({ length: 10 }, (_, i) =>
      trade({
        hash: `0x${i}`,
        trader: `0xt${i}`,
        side: i % 2 ? "buy" : "sell",
      }),
    );
    expect(scoreTradePatterns(dominated).score).toBeLessThan(
      scoreTradePatterns(spread).score,
    );
  });
});

describe("supply mechanics", () => {
  it("penalizes dev and top holder concentration on young tokens", () => {
    const concentrated = scoreSupplyMechanics(
      [{ address: "0x1", amount: "9", percentage: 85 }],
      { devHoldPercent: 60, creationTimeMs: NOW - 3 * DAY },
      NOW,
    );
    const distributed = scoreSupplyMechanics(
      [{ address: "0x1", amount: "9", percentage: 4 }],
      { devHoldPercent: 1, creationTimeMs: NOW - 300 * DAY },
      NOW,
    );
    expect(concentrated.score).toBeLessThan(distributed.score);
    expect(concentrated.mintConcentration).toBeGreaterThan(0.7);
  });

  it("returns neutral score with no data", () => {
    const none = scoreSupplyMechanics(
      [],
      { devHoldPercent: null, creationTimeMs: null },
      NOW,
    );
    expect(none.score).toBe(45);
    expect(none.mintConcentration).toBe(0);
  });
});

describe("token age", () => {
  it("scores older tokens higher", () => {
    const young = scoreTokenAge(NOW - DAY, NOW);
    const old = scoreTokenAge(NOW - 400 * DAY, NOW);
    expect(old).toBeGreaterThan(young);
  });
});

describe("risk levels and weights", () => {
  it("maps score bands", () => {
    expect(riskLevelFromScore(80)).toBe("LOW");
    expect(riskLevelFromScore(60)).toBe("MEDIUM");
    expect(riskLevelFromScore(40)).toBe("HIGH");
    expect(riskLevelFromScore(10)).toBe("CRITICAL");
  });

  it("weights holder concentration heaviest in composite", () => {
    const lowHolders = computeTokenScore({
      trust: 80,
      holders: 10,
      age: 80,
      trades: 80,
      supply: 80,
    });
    const highHolders = computeTokenScore({
      trust: 80,
      holders: 100,
      age: 80,
      trades: 80,
      supply: 80,
    });
    expect(highHolders - lowHolders).toBeGreaterThan(20);
  });
});

describe("verification gap handling", () => {
  it("flags missing trust signals instead of faking verification", () => {
    const info = tokenInfo({
      riskControlLevel: null,
      communityRecognized: false,
    });
    const result = computeTokenScan(TOKEN, info, [], [], NOW);
    expect(
      result.flags.some((f) =>
        /contract verification status unavailable/i.test(f),
      ),
    ).toBe(true);
  });

  it("keeps confidence lower without trust signals than with them", () => {
    const bare = computeTokenScan(TOKEN, tokenInfo(), [], [], NOW);
    const rich = computeTokenScan(
      TOKEN,
      tokenInfo({ riskControlLevel: 1, communityRecognized: true }),
      Array.from({ length: 10 }, (_, i) => ({
        address: `0x${i}`,
        amount: "1",
        percentage: 2,
      })),
      Array.from({ length: 25 }, (_, i) =>
        trade({ hash: `0x${i}`, trader: `0xt${i}`, side: i % 2 ? "buy" : "sell" }),
      ),
      NOW,
    );
    expect(rich.confidence).toBeGreaterThan(bare.confidence);
  });
});

describe("explanation", () => {
  it("has no em dashes and includes risk level", () => {
    const text = buildTokenExplanation(72, "MEDIUM", ["sample flag"], 60, "ABC");
    expect(text).toContain("MEDIUM");
    expect(text).not.toMatch(/\u2014/);
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
