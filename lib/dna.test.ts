import { describe, expect, it } from "vitest";
import {
  buildExplanation,
  computeAgentDna,
  computeConfidence,
  computeDeliveryProbability,
  computeGradeScore,
  computeOverallScore,
  scoreConsistency,
  scoreCounterpartyDiversity,
  scoreLongevity,
  scoreReliability,
  scoreRiskAppetite,
  scoreToGrade,
  TRAIT_WEIGHTS,
  UNRATED_CONFIDENCE_THRESHOLD,
  withDerivedFirstSeen,
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
    historyWindowDays: null,
    historyWindowCapped: false,
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

  it("returns low confidence, UNRATED grade, and honest explanation", () => {
    const result = computeAgentDna(SELF, summary, [], NOW);
    expect(result.confidence).toBeLessThanOrEqual(10);
    expect(result.grade).toBe("UNRATED");
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
      historyWindowDays: null,
      historyWindowCapped: false,
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
      historyWindowDays: null,
      historyWindowCapped: false,
    };
    const twoYear: AddressSummary = {
      address: SELF,
      firstSeenMs: NOW - 730 * DAY,
      lastSeenMs: NOW,
      txCount: 5,
      balance: "0",
      balanceSymbol: "OKB",
      isFresh: false,
      historyWindowDays: null,
      historyWindowCapped: false,
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
  it("maps scores to the calibrated bands", () => {
    expect(scoreToGrade(96)).toBe("A+");
    expect(scoreToGrade(91)).toBe("A");
    expect(scoreToGrade(86)).toBe("A-");
    expect(scoreToGrade(80)).toBe("B+");
    expect(scoreToGrade(74)).toBe("B");
    expect(scoreToGrade(68)).toBe("B-");
    expect(scoreToGrade(61)).toBe("C+");
    expect(scoreToGrade(54)).toBe("C");
    expect(scoreToGrade(45)).toBe("C-");
    expect(scoreToGrade(35)).toBe("D");
    expect(scoreToGrade(20)).toBe("F");
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

describe("longevity fallback when the summary lacks first-seen", () => {
  const summaryWithoutFirstSeen: AddressSummary = {
    address: SELF,
    firstSeenMs: null,
    lastSeenMs: null,
    txCount: 0,
    balance: "0",
    balanceSymbol: "OKB",
    isFresh: true,
    historyWindowDays: 183,
    historyWindowCapped: false,
  };

  it("derives first and last seen from fetched transactions", () => {
    const txs = [
      tx({ from: SELF, to: "0x2", timestampMs: NOW - 90 * DAY }),
      tx({ from: SELF, to: "0x3", timestampMs: NOW - DAY }),
    ];
    const derived = withDerivedFirstSeen(summaryWithoutFirstSeen, txs);
    expect(derived.firstSeenMs).toBe(NOW - 90 * DAY);
    expect(derived.lastSeenMs).toBe(NOW - DAY);
    expect(derived.isFresh).toBe(false);
  });

  it("scores 3 months of steady activity meaningfully above zero", () => {
    const txs: NormalizedTx[] = Array.from({ length: 90 }, (_, i) =>
      tx({
        from: SELF,
        to: `0x${(i + 2).toString(16).padStart(40, "0")}`,
        timestampMs: NOW - i * DAY,
        status: "success",
      }),
    );
    const result = computeAgentDna(SELF, summaryWithoutFirstSeen, txs, NOW);
    expect(result.traits.longevity).toBeGreaterThan(40);
    expect(result.grade).not.toBe("UNRATED");
  });

  it("leaves a truly empty summary untouched", () => {
    const derived = withDerivedFirstSeen(summaryWithoutFirstSeen, []);
    expect(derived).toEqual(summaryWithoutFirstSeen);
    expect(scoreLongevity(derived, NOW)).toBe(0);
  });
});

describe("longevity window ceiling", () => {
  it("caps a window-saturated address near the documented ceiling, not zero", () => {
    const summary: AddressSummary = {
      address: SELF,
      firstSeenMs: NOW - 183 * DAY,
      lastSeenMs: NOW,
      txCount: 100,
      balance: "1",
      balanceSymbol: "OKB",
      isFresh: false,
      historyWindowDays: 183,
      historyWindowCapped: true,
    };
    const score = scoreLongevity(summary, NOW);
    expect(score).toBeGreaterThanOrEqual(65);
    expect(score).toBeLessThanOrEqual(75);
  });
});

describe("grade coherence invariant", () => {
  it("never grades below C- when deliveryProbability is 60 or higher", () => {
    const steps = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    for (const reliability of steps) {
      for (const consistency of steps) {
        for (const longevity of steps) {
          for (const riskAppetite of [0, 100]) {
            const traits = {
              reliability,
              consistency,
              longevity,
              riskAppetite,
              activity: 0,
              counterpartyDiversity: 0,
            };
            const dp = computeDeliveryProbability(traits);
            if (dp < 60) continue;
            const grade = scoreToGrade(computeGradeScore(traits));
            expect(grade, `dp ${dp} graded ${grade}`).not.toBe("F");
            expect(grade, `dp ${dp} graded ${grade}`).not.toBe("D");
          }
        }
      }
    }
  });

  it("regression: reliability 100 with delivery 71 no longer grades F", () => {
    const traits = {
      reliability: 100,
      consistency: 87,
      longevity: 0,
      riskAppetite: 80,
      activity: 10,
      counterpartyDiversity: 8,
    };
    const dp = computeDeliveryProbability(traits);
    expect(dp).toBe(71);
    const grade = scoreToGrade(computeGradeScore(traits));
    expect(["C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"]).toContain(grade);
  });
});

describe("UNRATED state", () => {
  it("shows UNRATED instead of a letter grade below the confidence threshold", () => {
    const summary: AddressSummary = {
      address: SELF,
      firstSeenMs: NOW - DAY,
      lastSeenMs: NOW - DAY,
      txCount: 1,
      balance: "0.5",
      balanceSymbol: "OKB",
      isFresh: false,
      historyWindowDays: 183,
      historyWindowCapped: false,
    };
    const txs = [tx({ from: SELF, to: "0x2", timestampMs: NOW - DAY })];
    const result = computeAgentDna(SELF, summary, txs, NOW);
    expect(result.confidence).toBeLessThan(UNRATED_CONFIDENCE_THRESHOLD);
    expect(result.grade).toBe("UNRATED");
    expect(result.explanation.toLowerCase()).toContain("confidence is low");
  });

  it("shows a letter grade at or above the confidence threshold", () => {
    const summary: AddressSummary = {
      address: SELF,
      firstSeenMs: NOW - 60 * DAY,
      lastSeenMs: NOW,
      txCount: 60,
      balance: "1",
      balanceSymbol: "OKB",
      isFresh: false,
      historyWindowDays: 183,
      historyWindowCapped: false,
    };
    const txs = Array.from({ length: 60 }, (_, i) =>
      tx({
        from: SELF,
        to: `0x${(i + 2).toString(16).padStart(40, "0")}`,
        timestampMs: NOW - i * DAY,
      }),
    );
    const result = computeAgentDna(SELF, summary, txs, NOW);
    expect(result.confidence).toBeGreaterThanOrEqual(UNRATED_CONFIDENCE_THRESHOLD);
    expect(result.grade).not.toBe("UNRATED");
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
      historyWindowDays: null,
      historyWindowCapped: false,
    };
    const rich: AddressSummary = {
      address: SELF,
      firstSeenMs: NOW - 200 * DAY,
      lastSeenMs: NOW,
      txCount: 150,
      balance: "0",
      balanceSymbol: "OKB",
      isFresh: false,
      historyWindowDays: null,
      historyWindowCapped: false,
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

describe("history window cap", () => {
  const base: AddressSummary = {
    address: SELF,
    firstSeenMs: NOW - 170 * DAY,
    lastSeenMs: NOW,
    txCount: 100,
    balance: "1",
    balanceSymbol: "OKB",
    isFresh: false,
    historyWindowDays: 183,
    historyWindowCapped: false,
  };
  const txs = Array.from({ length: 100 }, (_, i) =>
    tx({
      from: SELF,
      to: `0x${(i + 2).toString(16).padStart(40, "0")}`,
      timestampMs: NOW - i * DAY,
    }),
  );

  it("reduces confidence when the window is saturated", () => {
    const capped = computeConfidence({ ...base, historyWindowCapped: true }, txs);
    const uncapped = computeConfidence(base, txs);
    expect(capped).toBeLessThan(uncapped);
  });

  it("notes the window in the explanation when capped", () => {
    const result = computeAgentDna(
      SELF,
      { ...base, historyWindowCapped: true },
      txs,
      NOW,
    );
    expect(result.explanation.toLowerCase()).toContain("six months");
  });

  it("does not note the window when uncapped", () => {
    const result = computeAgentDna(SELF, base, txs, NOW);
    expect(result.explanation.toLowerCase()).not.toContain("six months");
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
