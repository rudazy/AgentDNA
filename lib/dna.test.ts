import { describe, expect, it } from "vitest";
import {
  buildExplanation,
  computeAgentDna,
  computeConfidence,
  computeDeliveryProbability,
  computeOverallScore,
  scoreConsistency,
  scoreCounterpartyDiversity,
  scoreLongevity,
  scoreReliability,
  scoreRiskAppetite,
  scoreToGrade,
  TRAIT_WEIGHTS,
} from "./dna";
import type { AddressSummary, NormalizedTx } from "./types";

const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const DAY = 86_400_000;

function tx(
  partial: Partial<NormalizedTx> & Pick<NormalizedTx, "from" | "to">,
): NormalizedTx {
  return {
    hash: partial.hash ?? "0xabc",
    timestampMs: partial.timestampMs ?? NOW - DAY,
    from: partial.from,
    to: partial.to,
    method: partial.method ?? "transfer",
    value: partial.value ?? "1",
    status: partial.status ?? "success",
    counterpartyUnverifiedOrNew: partial.counterpartyUnverifiedOrNew,
  };
}

const SELF = "0x1111111111111111111111111111111111111111";

describe("TRAIT_WEIGHTS", () => {
  it("sums to 1", () => {
    const sum = Object.values(TRAIT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 8);
  });
});

describe("fresh wallet (zero txs)", () => {
  const summary: AddressSummary = {
    address: SELF,
    firstSeenMs: null,
    lastSeenMs: null,
    txCount: 0,
    balance: "0",
    balanceSymbol: "OKB",
    isFresh: true,
  };

  it("scores reliability 0", () => {
    expect(scoreReliability([], NOW)).toBe(0);
  });

  it("scores consistency 0", () => {
    expect(scoreConsistency([])).toBe(0);
  });

  it("scores longevity 0", () => {
    expect(scoreLongevity(summary, NOW)).toBe(0);
  });

  it("returns low confidence and grade F path with honest explanation", () => {
    const result = computeAgentDna(SELF, summary, [], NOW);
    expect(result.confidence).toBeLessThanOrEqual(10);
    expect(result.traits.reliability).toBe(0);
    expect(result.traits.activity).toBe(0);
    expect(result.explanation.toLowerCase()).toContain("little or no onchain history");
    expect(result.deliveryProbabilityLabel).toBe("heuristic estimate");
    expect(result.service).toBe("agent-dna");
    expect(result.scan).toBe("agent");
  });
});

describe("single-counterparty wallet", () => {
  const other = "0x2222222222222222222222222222222222222222";
  const txs: NormalizedTx[] = Array.from({ length: 20 }, (_, i) =>
    tx({
      from: SELF,
      to: other,
      timestampMs: NOW - i * DAY,
      status: "success",
      value: "10",
    }),
  );

  it("scores low counterparty diversity", () => {
    const d = scoreCounterpartyDiversity(SELF, txs);
    expect(d).toBeLessThan(25);
  });

  it("still produces a full DNA payload", () => {
    const summary: AddressSummary = {
      address: SELF,
      firstSeenMs: NOW - 20 * DAY,
      lastSeenMs: NOW,
      txCount: 20,
      balance: "1",
      balanceSymbol: "OKB",
      isFresh: false,
    };
    const result = computeAgentDna(SELF, summary, txs, NOW);
    expect(result.traits.counterpartyDiversity).toBeLessThan(25);
    expect(result.explanation.toLowerCase()).toMatch(/counterpart/);
  });
});

describe("reliability", () => {
  it("weights successes high when all succeed", () => {
    const txs = [
      tx({ from: SELF, to: "0x2", status: "success", timestampMs: NOW - DAY }),
      tx({
        from: SELF,
        to: "0x3",
        status: "success",
        timestampMs: NOW - 2 * DAY,
      }),
    ];
    expect(scoreReliability(txs, NOW)).toBeGreaterThanOrEqual(95);
  });

  it("drops when recent failures dominate", () => {
    const txs = [
      tx({ from: SELF, to: "0x2", status: "failed", timestampMs: NOW - DAY }),
      tx({
        from: SELF,
        to: "0x3",
        status: "failed",
        timestampMs: NOW - 2 * DAY,
      }),
      tx({
        from: SELF,
        to: "0x4",
        status: "success",
        timestampMs: NOW - 200 * DAY,
      }),
    ];
    expect(scoreReliability(txs, NOW)).toBeLessThan(50);
  });
});

describe("consistency", () => {
  it("scores higher for regular gaps than bursty dormancy", () => {
    const regular: NormalizedTx[] = Array.from({ length: 10 }, (_, i) =>
      tx({
        from: SELF,
        to: `0x${(i + 2).toString().padStart(40, "0")}`,
        timestampMs: NOW - i * DAY,
      }),
    );
    const bursty: NormalizedTx[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        tx({
          from: SELF,
          to: "0x2",
          timestampMs: NOW - i * (DAY / 24),
        }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        tx({
          from: SELF,
          to: "0x3",
          timestampMs: NOW - 180 * DAY - i * (DAY / 24),
        }),
      ),
    ];
    expect(scoreConsistency(regular)).toBeGreaterThan(scoreConsistency(bursty));
  });
});

describe("longevity log scale", () => {
  it("does not score a 2y wallet 100x a 1 week wallet", () => {
    const week: AddressSummary = {
      address: SELF,
      firstSeenMs: NOW - 7 * DAY,
      lastSeenMs: NOW,
      txCount: 5,
      balance: "0",
      balanceSymbol: "OKB",
      isFresh: false,
    };
    const twoYear: AddressSummary = {
      address: SELF,
      firstSeenMs: NOW - 730 * DAY,
      lastSeenMs: NOW,
      txCount: 5,
      balance: "0",
      balanceSymbol: "OKB",
      isFresh: false,
    };
    const a = scoreLongevity(week, NOW);
    const b = scoreLongevity(twoYear, NOW);
    expect(b).toBeGreaterThan(a);
    expect(b / Math.max(a, 1)).toBeLessThan(20);
  });
});

describe("risk appetite", () => {
  it("rises with unverified heavy and value concentration", () => {
    const mild = [
      tx({ from: SELF, to: "0x2", value: "1", counterpartyUnverifiedOrNew: false }),
      tx({ from: SELF, to: "0x3", value: "1", counterpartyUnverifiedOrNew: false }),
    ];
    const spicy = [
      tx({
        from: SELF,
        to: "0x2",
        value: "1000",
        counterpartyUnverifiedOrNew: true,
      }),
      tx({
        from: SELF,
        to: "0x3",
        value: "1",
        counterpartyUnverifiedOrNew: true,
      }),
    ];
    const mildScore = scoreRiskAppetite(mild);
    const spicyScore = scoreRiskAppetite(spicy);
    expect(spicyScore).toBeGreaterThan(mildScore);
    expect(mildScore).toBeLessThan(40);
    expect(spicyScore).toBeGreaterThan(60);
  });
});

describe("grade and delivery", () => {
  it("maps high scores to A-range grades", () => {
    expect(scoreToGrade(98)).toBe("A+");
    expect(scoreToGrade(50)).toBe("F");
    expect(scoreToGrade(85)).toBe("B");
  });

  it("delivery probability is a blend of three traits", () => {
    const traits = {
      reliability: 80,
      consistency: 60,
      longevity: 40,
      riskAppetite: 50,
      activity: 50,
      counterpartyDiversity: 50,
    };
    const p = computeDeliveryProbability(traits);
    expect(p).toBeGreaterThan(50);
    expect(p).toBeLessThan(80);
  });

  it("overall score uses weights", () => {
    const traits = {
      reliability: 100,
      consistency: 100,
      longevity: 100,
      riskAppetite: 0,
      activity: 100,
      counterpartyDiversity: 100,
    };
    expect(computeOverallScore(traits)).toBeGreaterThan(95);
  });
});

describe("confidence", () => {
  it("grows with tx volume", () => {
    const sparse: AddressSummary = {
      address: SELF,
      firstSeenMs: NOW - DAY,
      lastSeenMs: NOW,
      txCount: 2,
      balance: "0",
      balanceSymbol: "OKB",
      isFresh: false,
    };
    const rich: AddressSummary = {
      address: SELF,
      firstSeenMs: NOW - 200 * DAY,
      lastSeenMs: NOW,
      txCount: 150,
      balance: "0",
      balanceSymbol: "OKB",
      isFresh: false,
    };
    const txsSparse = [
      tx({ from: SELF, to: "0x2", timestampMs: NOW - DAY }),
      tx({ from: SELF, to: "0x3", timestampMs: NOW }),
    ];
    const txsRich = Array.from({ length: 80 }, (_, i) =>
      tx({
        from: SELF,
        to: `0x${(i + 2).toString(16).padStart(40, "0")}`,
        timestampMs: NOW - i * DAY,
      }),
    );
    expect(computeConfidence(rich, txsRich)).toBeGreaterThan(
      computeConfidence(sparse, txsSparse),
    );
  });
});

describe("explanation templates", () => {
  it("never includes em dashes", () => {
    const traits = {
      reliability: 82,
      consistency: 74,
      longevity: 61,
      riskAppetite: 38,
      activity: 70,
      counterpartyDiversity: 66,
    };
    const text = buildExplanation(traits, "B+", 71, 78, false);
    expect(text).not.toMatch(/\u2014/);
    expect(text.length).toBeGreaterThan(40);
  });
});
