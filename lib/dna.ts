/**
 * Agent Scan scoring engine.
 * Pure functions of address history. Deterministic. No LLM calls.
 */

import type {
  AddressSummary,
  AgentScanResponse,
  AgentTraits,
  Grade,
  NormalizedTx,
} from "./types";
import { SERVICE_NAME, SERVICE_VERSION } from "./types";

/** Tunable grade blend weights (must sum to 1). */
export const TRAIT_WEIGHTS = {
  reliability: 0.25,
  consistency: 0.18,
  longevity: 0.15,
  riskAppetite: 0.08,
  activity: 0.17,
  counterpartyDiversity: 0.17,
} as const;

/** Delivery probability blend (heuristic). */
export const DELIVERY_WEIGHTS = {
  reliability: 0.45,
  consistency: 0.3,
  longevity: 0.25,
} as const;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const YEAR_MS = 365.25 * DAY_MS;

function clamp(n: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function roundTrait(n: number): number {
  return Math.round(clamp(n));
}

function parseValue(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

/**
 * Reliability: successful vs failed txs, weighted toward recent activity.
 * Exponential recency weight with ~30 day half-life.
 */
export function scoreReliability(txs: NormalizedTx[], nowMs = Date.now()): number {
  if (txs.length === 0) return 0;

  const halfLife = 30 * DAY_MS;
  let successW = 0;
  let totalW = 0;

  for (const tx of txs) {
    if (tx.status === "unknown") continue;
    const age = Math.max(0, nowMs - tx.timestampMs);
    const w = Math.exp(-Math.LN2 * (age / halfLife));
    totalW += w;
    if (tx.status === "success") successW += w;
  }

  if (totalW === 0) {
    // All unknown: mild default from raw count if any txs exist.
    return roundTrait(55);
  }

  const ratio = successW / totalW;
  // Map 0..1 to 0..100 with a gentle floor for sparse data.
  return roundTrait(ratio * 100);
}

/**
 * Consistency: regularity of activity over time.
 * Low variance in inter-tx gaps scores high; long dormancy then bursts scores low.
 */
export function scoreConsistency(txs: NormalizedTx[]): number {
  if (txs.length === 0) return 0;
  if (txs.length === 1) return 35;

  const times = txs
    .map((t) => t.timestampMs)
    .filter((t) => t > 0)
    .sort((a, b) => a - b);

  if (times.length < 2) return 35;

  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const prev = times[i - 1]!;
    const cur = times[i]!;
    gaps.push(cur - prev);
  }

  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean <= 0) return 50;

  const variance =
    gaps.reduce((acc, g) => acc + (g - mean) ** 2, 0) / gaps.length;
  const std = Math.sqrt(variance);
  const cv = std / mean; // coefficient of variation

  // Also penalize extreme max gap relative to mean (dormancy).
  const maxGap = Math.max(...gaps);
  const dormancyRatio = maxGap / mean;

  // cv ~0 is perfect; cv > 2 is very bursty. dormancyRatio > 10 is harsh.
  const cvScore = clamp(100 - cv * 40);
  const dormancyPenalty = clamp((dormancyRatio - 3) * 8, 0, 40);

  return roundTrait(cvScore - dormancyPenalty);
}

/**
 * Longevity: wallet age, log scaled so 2y is not 100x a 1 week wallet.
 * log10(1 + ageDays) scaled so ~2 years approaches high scores.
 */
export function scoreLongevity(
  summary: AddressSummary,
  nowMs = Date.now(),
): number {
  if (summary.isFresh || summary.firstSeenMs === null) return 0;

  const ageMs = Math.max(0, nowMs - summary.firstSeenMs);
  const ageDays = ageMs / DAY_MS;
  // log10(1+days): 7d~0.9, 30d~1.5, 365d~2.56, 730d~2.86
  // Scale so 730 days (~2y) ~ 90, asymptotic toward 100.
  const logScore = (Math.log10(1 + ageDays) / Math.log10(1 + 730)) * 90;
  return roundTrait(logScore);
}

/**
 * Risk appetite: descriptive, not good/bad.
 * High when many interactions with unverified/new contracts and high value concentration.
 */
export function scoreRiskAppetite(txs: NormalizedTx[]): number {
  if (txs.length === 0) return 0;

  let unverified = 0;
  const values = txs.map((t) => parseValue(t.value));
  const totalValue = values.reduce((a, b) => a + b, 0);

  for (const tx of txs) {
    if (tx.counterpartyUnverifiedOrNew) unverified += 1;
  }

  const unverifiedShare = unverified / txs.length;

  let concentration = 0;
  if (totalValue > 0) {
    const maxV = Math.max(...values);
    concentration = maxV / totalValue;
  } else {
    // No value signal: use method diversity inverse as weak proxy for "concentration".
    const methods = new Set(txs.map((t) => t.method));
    concentration = 1 - Math.min(1, methods.size / Math.max(1, txs.length));
  }

  // 60% unverified share, 40% value concentration. Already on a 0-100 scale.
  const raw = unverifiedShare * 60 + concentration * 40;
  return roundTrait(raw);
}

/**
 * Activity: recent volume and cadence relative to age.
 */
export function scoreActivity(
  summary: AddressSummary,
  txs: NormalizedTx[],
  nowMs = Date.now(),
): number {
  if (summary.isFresh || txs.length === 0) return 0;

  const ageMs =
    summary.firstSeenMs !== null
      ? Math.max(DAY_MS, nowMs - summary.firstSeenMs)
      : YEAR_MS;
  const ageDays = ageMs / DAY_MS;

  const recentCutoff = nowMs - 30 * DAY_MS;
  const recentCount = txs.filter((t) => t.timestampMs >= recentCutoff).length;
  const totalCount = Math.max(summary.txCount, txs.length);

  // Cadence: txs per day over lifetime, log compressed.
  const cadence = totalCount / ageDays;
  const cadenceScore = clamp((Math.log10(1 + cadence * 10) / Math.log10(11)) * 50);

  // Recent share of sample.
  const recentScore = clamp((recentCount / Math.min(txs.length, 50)) * 50);

  // Absolute volume bonus (capped).
  const volumeBonus = clamp(Math.log10(1 + totalCount) * 12, 0, 25);

  return roundTrait(cadenceScore * 0.45 + recentScore * 0.4 + volumeBonus * 0.15);
}

/**
 * Counterparty diversity: unique counterparties relative to total tx count.
 * Wallet that only ever talks to 2 addresses scores low.
 */
export function scoreCounterpartyDiversity(
  address: string,
  txs: NormalizedTx[],
): number {
  if (txs.length === 0) return 0;

  const self = address.toLowerCase();
  const counterparties = new Set<string>();

  for (const tx of txs) {
    const from = tx.from.toLowerCase();
    const to = tx.to.toLowerCase();
    if (from && from !== self) counterparties.add(from);
    if (to && to !== self) counterparties.add(to);
  }

  const unique = counterparties.size;
  if (unique === 0) return 0;
  if (unique === 1) return 8;
  if (unique === 2) return 18;

  // Ratio unique/tx, with absolute diversity ceiling.
  const ratio = unique / txs.length;
  const ratioScore = clamp(ratio * 100);
  const absoluteScore = clamp((Math.log10(1 + unique) / Math.log10(51)) * 100);

  return roundTrait(ratioScore * 0.55 + absoluteScore * 0.45);
}

export function computeTraits(
  address: string,
  summary: AddressSummary,
  txs: NormalizedTx[],
  nowMs = Date.now(),
): AgentTraits {
  return {
    reliability: scoreReliability(txs, nowMs),
    consistency: scoreConsistency(txs),
    longevity: scoreLongevity(summary, nowMs),
    riskAppetite: scoreRiskAppetite(txs),
    activity: scoreActivity(summary, txs, nowMs),
    counterpartyDiversity: scoreCounterpartyDiversity(address, txs),
  };
}

/**
 * Overall grade from weighted blend.
 * Risk appetite is descriptive: we invert it for "grade" so high risk appetite lowers grade slightly.
 */
export function computeOverallScore(traits: AgentTraits): number {
  const riskForGrade = 100 - traits.riskAppetite;
  const blended =
    traits.reliability * TRAIT_WEIGHTS.reliability +
    traits.consistency * TRAIT_WEIGHTS.consistency +
    traits.longevity * TRAIT_WEIGHTS.longevity +
    riskForGrade * TRAIT_WEIGHTS.riskAppetite +
    traits.activity * TRAIT_WEIGHTS.activity +
    traits.counterpartyDiversity * TRAIT_WEIGHTS.counterpartyDiversity;

  return clamp(blended);
}

export function scoreToGrade(score: number): Grade {
  const s = clamp(score);
  if (s >= 97) return "A+";
  if (s >= 93) return "A";
  if (s >= 90) return "A-";
  if (s >= 87) return "B+";
  if (s >= 83) return "B";
  if (s >= 80) return "B-";
  if (s >= 77) return "C+";
  if (s >= 73) return "C";
  if (s >= 70) return "C-";
  if (s >= 60) return "D";
  return "F";
}

/**
 * Confidence 0-100 from data volume. Fresh wallet gets low confidence, not a fake grade.
 * When the data source history window is saturated (history likely extends past
 * what is visible), the evidence is truncated and confidence is reduced.
 */
export const WINDOW_CAPPED_CONFIDENCE_FACTOR = 0.85;

export function computeConfidence(
  summary: AddressSummary,
  txs: NormalizedTx[],
): number {
  if (summary.isFresh || (summary.txCount === 0 && txs.length === 0)) {
    return 5;
  }

  const n = Math.max(summary.txCount, txs.length);
  // log scale: 1 tx ~ 15, 10 ~ 45, 50 ~ 70, 200+ ~ 90+
  const volume = clamp((Math.log10(1 + n) / Math.log10(201)) * 85, 0, 85);

  const spanDays =
    summary.firstSeenMs !== null && summary.lastSeenMs !== null
      ? Math.max(0, (summary.lastSeenMs - summary.firstSeenMs) / DAY_MS)
      : 0;
  const spanBonus = clamp(Math.log10(1 + spanDays) * 8, 0, 15);

  const raw = volume + spanBonus;
  const factor = summary.historyWindowCapped
    ? WINDOW_CAPPED_CONFIDENCE_FACTOR
    : 1;
  return roundTrait(raw * factor);
}

/**
 * Heuristic delivery probability from Reliability, Consistency, Longevity.
 */
export function computeDeliveryProbability(traits: AgentTraits): number {
  const p =
    traits.reliability * DELIVERY_WEIGHTS.reliability +
    traits.consistency * DELIVERY_WEIGHTS.consistency +
    traits.longevity * DELIVERY_WEIGHTS.longevity;
  return roundTrait(p);
}

type TraitKey = keyof AgentTraits;

const TRAIT_LABELS: Record<TraitKey, string> = {
  reliability: "reliability",
  consistency: "consistency",
  longevity: "longevity",
  riskAppetite: "risk appetite",
  activity: "activity",
  counterpartyDiversity: "counterparty diversity",
};

function rankedTraits(traits: AgentTraits): { key: TraitKey; value: number }[] {
  return (Object.keys(traits) as TraitKey[])
    .map((key) => ({ key, value: traits[key] }))
    .sort((a, b) => b.value - a.value);
}

/**
 * 2-4 plain-language sentences from deterministic templates.
 * No em dashes. No LLM.
 */
export function buildExplanation(
  traits: AgentTraits,
  grade: Grade,
  confidence: number,
  deliveryProbability: number,
  isFresh: boolean,
  historyWindowCapped = false,
): string {
  if (isFresh || confidence <= 10) {
    return [
      "This address has little or no onchain history on X Layer, so confidence is low.",
      "Grades and delivery estimates on fresh wallets are not reliable hiring signals.",
      "Re-scan after the identity accumulates successful, diversified activity.",
    ].join(" ");
  }

  const ranked = rankedTraits(traits);
  const strongest = ranked[0]!;
  const weakest = ranked[ranked.length - 1]!;

  const sentences: string[] = [];

  sentences.push(
    `Overall grade ${grade} with confidence ${confidence}/100 based on observed X Layer behavior.`,
  );

  sentences.push(
    `Strongest trait is ${TRAIT_LABELS[strongest.key]} (${strongest.value}/100); weakest is ${TRAIT_LABELS[weakest.key]} (${weakest.value}/100).`,
  );

  if (traits.reliability >= 75) {
    sentences.push(
      "Transaction success rate is solid, including recent activity weight.",
    );
  } else if (traits.reliability < 45) {
    sentences.push(
      "Failed or unstable transactions pull reliability down; treat counterparty risk carefully.",
    );
  }

  if (traits.counterpartyDiversity < 25) {
    sentences.push(
      "Activity concentrates on very few counterparties, which limits behavioral evidence.",
    );
  } else if (traits.counterpartyDiversity >= 70) {
    sentences.push(
      "Counterparty set is relatively diverse relative to transaction count.",
    );
  }

  sentences.push(
    `Delivery probability is ${deliveryProbability}/100 (heuristic estimate from reliability, consistency, and longevity).`,
  );

  const picked = sentences.slice(0, 4);
  if (historyWindowCapped) {
    picked.push(
      "The data source only exposes about six months of history, so longevity reflects observed activity and confidence is reduced.",
    );
  }
  return picked.join(" ");
}

/** Full agent DNA scan from already-fetched data. */
export function computeAgentDna(
  address: string,
  summary: AddressSummary,
  txs: NormalizedTx[],
  nowMs = Date.now(),
): AgentScanResponse {
  const traits = computeTraits(address, summary, txs, nowMs);
  const overall = computeOverallScore(traits);
  const grade = scoreToGrade(overall);
  const confidence = computeConfidence(summary, txs);
  const deliveryProbability = computeDeliveryProbability(traits);
  const explanation = buildExplanation(
    traits,
    grade,
    confidence,
    deliveryProbability,
    summary.isFresh,
    summary.historyWindowCapped,
  );

  return {
    service: SERVICE_NAME,
    scan: "agent",
    address,
    grade,
    traits,
    deliveryProbability,
    deliveryProbabilityLabel: "heuristic estimate",
    confidence,
    explanation,
    scannedAt: new Date(nowMs).toISOString(),
    version: SERVICE_VERSION,
  };
}
