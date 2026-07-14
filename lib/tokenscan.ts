/**
 * Token Scan safety scoring.
 * Formula-based behavioral scoring. Deterministic templates. No EigenTrust / graphs.
 *
 * Data-source note: OKX OS exposes no contract source verification endpoint,
 * so the old verification component is replaced by trust signals
 * (communityRecognized, riskControlLevel, honeypot tag) with weight
 * redistributed to holders, age, and trade patterns. Raw ERC-20 transfer
 * lists are also unavailable; trade patterns score DEX trade flow instead.
 */

import type {
  RiskLevel,
  TokenHolder,
  TokenInfo,
  TokenScanResponse,
  TokenTrade,
} from "./types";
import { SERVICE_NAME, SERVICE_VERSION } from "./types";

const DAY_MS = 86_400_000;

/**
 * Tunable composite weights (must sum to 1).
 * Old formula: verification 0.35, holders 0.25, age 0.15, transfers 0.15, supply 0.10.
 * Verification is unavailable on OKX OS; its weight is redistributed to
 * holders, age, and trades, with trust signals keeping a reduced share.
 */
export const TOKEN_SCORE_WEIGHTS = {
  trust: 0.2,
  holders: 0.3,
  age: 0.2,
  trades: 0.2,
  supply: 0.1,
} as const;

function clamp(n: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function roundScore(n: number): number {
  return Math.round(clamp(n));
}

/**
 * Trust signals: replaces contract verification (heavy weight component 0-100).
 * Honeypot tag zeroes the component. riskControlLevel (0-5, data source) sets
 * the base; community recognition lifts it.
 */
export function scoreTrustSignals(info: TokenInfo): number {
  if (info.honeypot) return 0;

  let base: number;
  switch (info.riskControlLevel) {
    case 1:
      base = 90;
      break;
    case 2:
      base = 65;
      break;
    case 3:
      base = 40;
      break;
    case 4:
      base = 12;
      break;
    case 5:
      base = 5;
      break;
    default:
      // null or 0: undefined risk level, neutral base.
      base = 45;
  }

  if (info.communityRecognized) {
    base = Math.min(100, base + 30);
  }
  return roundScore(base);
}

/**
 * Holder concentration: top 10 holders percentage.
 * Uses the holder list when present, else the source-provided top 10 percent.
 * Over 70% is a strong red flag (low safety contribution).
 */
export function scoreHolderConcentration(
  holders: TokenHolder[],
  top10FromSource: number | null = null,
): { score: number; top10Pct: number; hasData: boolean } {
  let top10Pct: number;
  if (holders.length > 0) {
    const sorted = [...holders].sort((a, b) => b.percentage - a.percentage);
    top10Pct = sorted.slice(0, 10).reduce((acc, h) => acc + h.percentage, 0);
  } else if (top10FromSource !== null) {
    top10Pct = top10FromSource;
  } else {
    return { score: 40, top10Pct: 0, hasData: false };
  }

  // 0% concentration -> 100, 70% -> ~25, 90%+ -> near 0
  let score: number;
  if (top10Pct <= 20) score = 100;
  else if (top10Pct <= 40) score = 85 - (top10Pct - 20);
  else if (top10Pct <= 70) score = 65 - (top10Pct - 40) * 1.2;
  else if (top10Pct <= 90) score = 29 - (top10Pct - 70) * 1.1;
  else score = Math.max(0, 7 - (top10Pct - 90) * 0.7);

  return { score: roundScore(score), top10Pct, hasData: true };
}

/** Token age: older is safer for this heuristic. */
export function scoreTokenAge(
  creationTimeMs: number | null,
  nowMs = Date.now(),
): number {
  if (creationTimeMs === null) return 35;

  const ageDays = Math.max(0, (nowMs - creationTimeMs) / DAY_MS);
  // <1d low, 7d moderate, 90d solid, 365d high
  if (ageDays < 1) return 10;
  if (ageDays < 7) return 25;
  if (ageDays < 30) return 45;
  if (ageDays < 90) return 65;
  if (ageDays < 180) return 80;
  if (ageDays < 365) return 90;
  return 96;
}

/**
 * Trade pattern sanity over DEX trades: few traders, one-sided flow,
 * or a single dominant trader are flags. Higher = healthier trading.
 */
export function scoreTradePatterns(trades: TokenTrade[]): {
  score: number;
  uniqueTraders: number;
  buyCount: number;
  sellCount: number;
  oneSidedRatio: number;
} {
  if (trades.length === 0) {
    return {
      score: 40,
      uniqueTraders: 0,
      buyCount: 0,
      sellCount: 0,
      oneSidedRatio: 0,
    };
  }

  const traders = new Map<string, number>();
  let buyCount = 0;
  let sellCount = 0;

  for (const t of trades) {
    if (t.trader) {
      traders.set(t.trader, (traders.get(t.trader) ?? 0) + 1);
    }
    if (t.side === "buy") buyCount += 1;
    else if (t.side === "sell") sellCount += 1;
  }

  const sided = buyCount + sellCount;
  // 0 = perfectly balanced flow, 1 = all buys or all sells.
  const oneSidedRatio = sided > 0 ? Math.abs(buyCount - sellCount) / sided : 0;

  const uniqueTraders = traders.size;
  const diversity = clamp(
    (Math.log10(1 + uniqueTraders) / Math.log10(41)) * 55,
  );
  const flowScore = clamp((1 - oneSidedRatio) * 35);

  const maxByOne = traders.size > 0 ? Math.max(...traders.values()) : 0;
  const dominantShare = trades.length > 0 ? maxByOne / trades.length : 0;
  const dominancePenalty = clamp((dominantShare - 0.4) * 45, 0, 25);

  const score = roundScore(diversity + flowScore - dominancePenalty + 10);
  return { score, uniqueTraders, buyCount, sellCount, oneSidedRatio };
}

/**
 * Supply mechanics visible in data: top holder dominance and developer
 * position share (advanced-info) proxy mint/deploy concentration.
 */
export function scoreSupplyMechanics(
  holders: TokenHolder[],
  info: Pick<TokenInfo, "devHoldPercent" | "creationTimeMs">,
  nowMs = Date.now(),
): { score: number; mintConcentration: number } {
  const sortedHolders = [...holders].sort(
    (a, b) => b.percentage - a.percentage,
  );
  const top1 = sortedHolders[0]?.percentage ?? null;
  const dev = info.devHoldPercent;

  if (top1 === null && dev === null) {
    return { score: 45, mintConcentration: 0 };
  }

  // Young + concentrated = mint concentration risk.
  const ageDays =
    info.creationTimeMs !== null
      ? Math.max(0, (nowMs - info.creationTimeMs) / DAY_MS)
      : 999;
  const youngBoost = ageDays < 14 ? 1.2 : 1;

  const concentrationPct = Math.max(top1 ?? 0, dev ?? 0);
  const mintConcentration = clamp(concentrationPct / 100, 0, 1) * youngBoost;

  // High mint concentration lowers safety score.
  const score = roundScore(100 - mintConcentration * 85);
  return { score, mintConcentration };
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 75) return "LOW";
  if (score >= 55) return "MEDIUM";
  if (score >= 35) return "HIGH";
  return "CRITICAL";
}

export function computeTokenConfidence(
  info: TokenInfo,
  holders: TokenHolder[],
  trades: TokenTrade[],
): number {
  let c = 20;
  if (info.riskControlLevel !== null) c += 10;
  if (info.communityRecognized) c += 5;
  if (info.creationTimeMs !== null) c += 10;
  if (info.totalSupply !== "0") c += 5;
  if (holders.length >= 5) c += 20;
  else if (holders.length > 0) c += 10;
  else if (info.top10HoldPercent !== null) c += 10;
  if (trades.length >= 20) c += 20;
  else if (trades.length > 0) c += 10;
  if (info.holderCount !== null && info.holderCount > 50) c += 5;
  return roundScore(c);
}

export function buildTokenFlags(input: {
  info: Pick<
    TokenInfo,
    "honeypot" | "riskControlLevel" | "communityRecognized" | "creationTimeMs"
  >;
  top10Pct: number;
  holderDataAvailable: boolean;
  ageScore: number;
  trade: ReturnType<typeof scoreTradePatterns>;
  tradeCount: number;
  mintConcentration: number;
  nowMs?: number;
}): string[] {
  const flags: string[] = [];
  const nowMs = input.nowMs ?? Date.now();
  const { info } = input;

  if (info.honeypot) {
    flags.push("Data source flags this token as a honeypot");
  }
  if (info.riskControlLevel !== null && info.riskControlLevel >= 4) {
    flags.push("Data source risk control level is high");
  }
  if (info.riskControlLevel === null && !info.communityRecognized) {
    flags.push(
      "Contract verification status unavailable on this data source; trust signal limited",
    );
  }
  if (!input.holderDataAvailable) {
    flags.push("Holder distribution unavailable on this data source");
  } else if (input.top10Pct >= 90) {
    flags.push("Top 10 holders control over 90 percent of supply");
  } else if (input.top10Pct >= 70) {
    flags.push("Top 10 holders control over 70 percent of supply");
  }
  if (info.creationTimeMs !== null) {
    const ageDays = (nowMs - info.creationTimeMs) / DAY_MS;
    if (ageDays < 7) {
      flags.push("Token is less than 7 days old");
    } else if (ageDays < 30) {
      flags.push("Token is less than 30 days old");
    }
  } else {
    flags.push("Token creation time is unknown");
  }
  if (
    input.tradeCount >= 3 &&
    input.trade.oneSidedRatio >= 0.85 &&
    input.trade.uniqueTraders <= 5
  ) {
    flags.push("DEX trade flow is one-sided among very few traders");
  }
  if (input.trade.uniqueTraders === 1 && input.tradeCount >= 3) {
    flags.push("All observed DEX trades come from a single trader");
  }
  if (input.mintConcentration >= 0.7) {
    flags.push("High mint or deploy concentration among top holders");
  }
  if (input.ageScore <= 25 && info.riskControlLevel !== null && info.riskControlLevel >= 3) {
    flags.push("Risky and very new: elevated interaction risk");
  }

  return flags;
}

/** Weighted safety score 0-100 (weights from TOKEN_SCORE_WEIGHTS). */
export function computeTokenScore(parts: {
  trust: number;
  holders: number;
  age: number;
  trades: number;
  supply: number;
}): number {
  return roundScore(
    parts.trust * TOKEN_SCORE_WEIGHTS.trust +
      parts.holders * TOKEN_SCORE_WEIGHTS.holders +
      parts.age * TOKEN_SCORE_WEIGHTS.age +
      parts.trades * TOKEN_SCORE_WEIGHTS.trades +
      parts.supply * TOKEN_SCORE_WEIGHTS.supply,
  );
}

export function buildTokenExplanation(
  score: number,
  riskLevel: RiskLevel,
  flags: string[],
  confidence: number,
  symbol: string,
): string {
  const sentences: string[] = [];

  sentences.push(
    `${symbol} safety score is ${score}/100 (${riskLevel}) with confidence ${confidence}/100.`,
  );

  if (flags.length === 0) {
    sentences.push(
      "No major structural red flags were raised from trust signals, holder concentration, age, or trade patterns.",
    );
  } else {
    sentences.push(`Primary flags: ${flags.slice(0, 3).join("; ")}.`);
  }

  if (riskLevel === "CRITICAL" || riskLevel === "HIGH") {
    sentences.push(
      "Treat interaction, swaps, and LP entry as high risk until more evidence exists.",
    );
  } else if (riskLevel === "MEDIUM") {
    sentences.push(
      "Proceed only with sized exposure and additional due diligence beyond this scan.",
    );
  } else {
    sentences.push(
      "Structural signals look comparatively safer, but this is not investment advice.",
    );
  }

  return sentences.join(" ");
}

/** Full token scan from already-fetched data. */
export function computeTokenScan(
  address: string,
  info: TokenInfo,
  holders: TokenHolder[],
  trades: TokenTrade[],
  nowMs = Date.now(),
): TokenScanResponse {
  const trust = scoreTrustSignals(info);
  const holderPart = scoreHolderConcentration(holders, info.top10HoldPercent);
  const age = scoreTokenAge(info.creationTimeMs, nowMs);
  const tradePart = scoreTradePatterns(trades);
  const supplyPart = scoreSupplyMechanics(holders, info, nowMs);

  const score = computeTokenScore({
    trust,
    holders: holderPart.score,
    age,
    trades: tradePart.score,
    supply: supplyPart.score,
  });

  const riskLevel = riskLevelFromScore(score);
  const confidence = computeTokenConfidence(info, holders, trades);
  const flags = buildTokenFlags({
    info,
    top10Pct: holderPart.top10Pct,
    holderDataAvailable: holderPart.hasData,
    ageScore: age,
    trade: tradePart,
    tradeCount: trades.length,
    mintConcentration: supplyPart.mintConcentration,
    nowMs,
  });

  const explanation = buildTokenExplanation(
    score,
    riskLevel,
    flags,
    confidence,
    info.symbol || "Token",
  );

  return {
    service: SERVICE_NAME,
    scan: "token",
    address,
    score,
    riskLevel,
    flags,
    confidence,
    explanation,
    scannedAt: new Date(nowMs).toISOString(),
    version: SERVICE_VERSION,
  };
}
