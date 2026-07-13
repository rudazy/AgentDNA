import { describe, expect, it } from "vitest";
import {
  buildTokenExplanation,
  buildTokenFlags,
  computeTokenScan,
  computeTokenScore,
  riskLevelFromScore,
  scoreHolderConcentration,
  scoreTokenAge,
  scoreTransferPatterns,
  scoreVerification,
} from "./tokenscan";
import type { TokenHolder, TokenInfo, TokenTransfer } from "./types";

const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const DAY = 86_400_000;
const TOKEN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("verification", () => {
  it("rewards verified contracts heavily", () => {
    expect(scoreVerification(true)).toBe(100);
    expect(scoreVerification(false)).toBe(15);
  });
});

describe("unverified new token", () => {
  it("flags and scores as high risk", () => {
    const info: TokenInfo = {
      address: TOKEN,
      name: "Risky",
      symbol: "RISK",
      totalSupply: "1000000",
      decimals: 18,
      creationTimeMs: NOW - 2 * DAY,
      verified: false,
      holderCount: 3,
    };
    const holders: TokenHolder[] = [
      { address: "0x1", amount: "900000", percentage: 90 },
      { address: "0x2", amount: "50000", percentage: 5 },
      { address: "0x3", amount: "50000", percentage: 5 },
    ];
    const transfers: TokenTransfer[] = [
      {
        hash: "0x1",
        timestampMs: NOW - DAY,
        from: "0x1",
        to: "0x2",
        amount: "1000",
      },
    ];
    const result = computeTokenScan(TOKEN, info, holders, transfers, NOW);
    expect(result.score).toBeLessThan(50);
    expect(["HIGH", "CRITICAL"]).toContain(result.riskLevel);
    expect(result.flags.some((f) => /not verified/i.test(f))).toBe(true);
    expect(result.flags.some((f) => /less than 7 days/i.test(f))).toBe(true);
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
    const { score, top10Pct } = scoreHolderConcentration(holders);
    expect(top10Pct).toBeCloseTo(80, 5);
    expect(score).toBeLessThan(40);

    const flags = buildTokenFlags({
      verified: true,
      top10Pct,
      ageScore: 80,
      transfer: scoreTransferPatterns([]),
      mintConcentration: 0.2,
      creationTimeMs: NOW - 100 * DAY,
    });
    expect(flags.some((f) => /70 percent/i.test(f))).toBe(true);
  });
});

describe("transfer patterns", () => {
  it("penalizes one-directional sinks", () => {
    const sink = "0xsink";
    const oneWay: TokenTransfer[] = Array.from({ length: 12 }, (_, i) => ({
      hash: `0x${i}`,
      timestampMs: NOW - i * DAY,
      from: `0xsender${i}`,
      to: sink,
      amount: "10",
    }));
    const twoWay: TokenTransfer[] = [
      {
        hash: "0xa",
        timestampMs: NOW,
        from: "0x1",
        to: "0x2",
        amount: "1",
      },
      {
        hash: "0xb",
        timestampMs: NOW - DAY,
        from: "0x2",
        to: "0x1",
        amount: "1",
      },
      {
        hash: "0xc",
        timestampMs: NOW - 2 * DAY,
        from: "0x3",
        to: "0x4",
        amount: "1",
      },
      {
        hash: "0xd",
        timestampMs: NOW - 3 * DAY,
        from: "0x4",
        to: "0x3",
        amount: "1",
      },
    ];
    const a = scoreTransferPatterns(oneWay);
    const b = scoreTransferPatterns(twoWay);
    expect(a.oneWayRatio).toBeGreaterThan(0.8);
    expect(a.score).toBeLessThan(b.score);
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

  it("weights verification heavily in composite", () => {
    const lowVerify = computeTokenScore({
      verification: 15,
      holders: 80,
      age: 80,
      transfers: 80,
      supply: 80,
    });
    const highVerify = computeTokenScore({
      verification: 100,
      holders: 80,
      age: 80,
      transfers: 80,
      supply: 80,
    });
    expect(highVerify - lowVerify).toBeGreaterThan(20);
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
