/**
 * Token Scan safety scoring.
 * Formula-based behavioral scoring. Deterministic templates. No EigenTrust / graphs.
 */

import type {
  RiskLevel,
  TokenHolder,
  TokenInfo,
  TokenScanResponse,
  TokenTransfer,
} from "./types";
import { SERVICE_NAME, SERVICE_VERSION } from "./types";

const DAY_MS = 86_400_000;

function clamp(n: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function roundScore(n: number): number {
  return Math.round(clamp(n));
}

/** Contract verification: heavy weight component 0-100. */
export function scoreVerification(verified: boolean): number {
  return verified ? 100 : 15;
}

/**
 * Holder concentration: top 10 holders percentage.
 * Over 70% is a strong red flag (low safety contribution).
 */
export function scoreHolderConcentration(holders: TokenHolder[]): {
  score: number;
  top10Pct: number;
} {
  if (holders.length === 0) {
    return { score: 40, top10Pct: 0 };
  }

  const sorted = [...holders].sort((a, b) => b.percentage - a.percentage);
  const top10 = sorted.slice(0, 10);
  const top10Pct = top10.reduce((acc, h) => acc + h.percentage, 0);

  // 0% concentration -> 100, 70% -> ~25, 90%+ -> near 0
  let score: number;
  if (top10Pct <= 20) score = 100;
  else if (top10Pct <= 40) score = 85 - (top10Pct - 20);
  else if (top10Pct <= 70) score = 65 - (top10Pct - 40) * 1.2;
  else if (top10Pct <= 90) score = 29 - (top10Pct - 70) * 1.1;
  else score = Math.max(0, 7 - (top10Pct - 90) * 0.7);

  return { score: roundScore(score), top10Pct };
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
 * Transfer pattern sanity: one-directional flow to few addresses is a flag.
 * Returns score 0-100 (higher = healthier distribution of flow).
 */
export function scoreTransferPatterns(transfers: TokenTransfer[]): {
  score: number;
  uniqueSenders: number;
  uniqueReceivers: number;
  oneWayRatio: number;
} {
  if (transfers.length === 0) {
    return {
      score: 40,
      uniqueSenders: 0,
      uniqueReceivers: 0,
      oneWayRatio: 0,
    };
  }

  const senders = new Set<string>();
  const receivers = new Set<string>();
  const pairCounts = new Map<string, number>();

  for (const t of transfers) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    if (from) senders.add(from);
    if (to) receivers.add(to);
    if (from && to) {
      const key = `${from}->${to}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
  }

  // Directed edges that never reverse.
  let oneWay = 0;
  let directed = 0;
  const seen = new Set<string>();
  for (const t of transfers) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    if (!from || !to) continue;
    const forward = `${from}->${to}`;
    if (seen.has(forward)) continue;
    seen.add(forward);
    directed += 1;
    const reverse = `${to}->${from}`;
    if (!pairCounts.has(reverse)) oneWay += 1;
  }

  const oneWayRatio = directed > 0 ? oneWay / directed : 0;
  const receiverConcentration =
    receivers.size > 0 ? 1 / receivers.size : 1;

  // Many unique participants and two-way flow score higher.
  const diversity = clamp(
    (Math.log10(1 + senders.size + receivers.size) / Math.log10(41)) * 60,
  );
  const flowScore = clamp((1 - oneWayRatio) * 40);
  const sinkPenalty = clamp(receiverConcentration * 30, 0, 30);

  const score = roundScore(diversity + flowScore - sinkPenalty + 20);
  return {
    score,
    uniqueSenders: senders.size,
    uniqueReceivers: receivers.size,
    oneWayRatio,
  };
}

/**
 * Supply mechanics visible in data: mint concentration at deploy.
 * Approximated from earliest transfers leaving a single address with large share.
 */
export function scoreSupplyMechanics(
  holders: TokenHolder[],
  transfers: TokenTransfer[],
  creationTimeMs: number | null,
): { score: number; mintConcentration: number } {
  if (holders.length === 0 && transfers.length === 0) {
    return { score: 45, mintConcentration: 0 };
  }

  const sortedHolders = [...holders].sort(
    (a, b) => b.percentage - a.percentage,
  );
  const top1 = sortedHolders[0]?.percentage ?? 0;

  // Early transfer dominance: first 10 transfers from one address.
  let earlyDominance = 0;
  if (transfers.length > 0) {
    const ordered = [...transfers]
      .filter((t) => t.timestampMs > 0)
      .sort((a, b) => a.timestampMs - b.timestampMs)
      .slice(0, 10);
    if (ordered.length > 0) {
      const counts = new Map<string, number>();
      for (const t of ordered) {
        const f = t.from.toLowerCase();
        counts.set(f, (counts.get(f) ?? 0) + 1);
      }
      const maxFrom = Math.max(...counts.values());
      earlyDominance = maxFrom / ordered.length;
    }
  }

  // Young + top holder huge = mint concentration risk.
  const ageDays =
    creationTimeMs !== null
      ? Math.max(0, (Date.now() - creationTimeMs) / DAY_MS)
      : 999;
  const youngBoost = ageDays < 14 ? 1.2 : 1;

  const mintConcentration = clamp(
    (top1 / 100) * 0.6 + earlyDominance * 0.4,
    0,
    1,
  ) * youngBoost;

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
  transfers: TokenTransfer[],
): number {
  let c = 20;
  if (info.verified) c += 15;
  if (info.creationTimeMs !== null) c += 10;
  if (info.totalSupply !== "0") c += 10;
  if (holders.length >= 5) c += 20;
  else if (holders.length > 0) c += 10;
  if (transfers.length >= 20) c += 20;
  else if (transfers.length > 0) c += 10;
  if (info.holderCount !== null && info.holderCount > 50) c += 5;
  return roundScore(c);
}

export function buildTokenFlags(input: {
  verified: boolean;
  top10Pct: number;
  ageScore: number;
  transfer: ReturnType<typeof scoreTransferPatterns>;
  mintConcentration: number;
  creationTimeMs: number | null;
}): string[] {
  const flags: string[] = [];

  if (!input.verified) {
    flags.push("Contract source is not verified on the explorer");
  }
  if (input.top10Pct >= 90) {
    flags.push("Top 10 holders control over 90 percent of supply");
  } else if (input.top10Pct >= 70) {
    flags.push("Top 10 holders control over 70 percent of supply");
  }
  if (input.creationTimeMs !== null) {
    const ageDays = (Date.now() - input.creationTimeMs) / DAY_MS;
    if (ageDays < 7) {
      flags.push("Token is less than 7 days old");
    } else if (ageDays < 30) {
      flags.push("Token is less than 30 days old");
    }
  } else {
    flags.push("Token creation time is unknown");
  }
  if (input.transfer.oneWayRatio >= 0.85 && input.transfer.uniqueReceivers <= 5) {
    flags.push("Transfers are mostly one-directional into few addresses");
  }
  if (input.transfer.uniqueReceivers === 1 && input.transfer.uniqueSenders >= 1) {
    flags.push("Nearly all transfers sink to a single receiver");
  }
  if (input.mintConcentration >= 0.7) {
    flags.push("High mint or deploy concentration among early holders");
  }
  if (input.ageScore <= 25 && !input.verified) {
    flags.push("Unverified and very new: elevated interaction risk");
  }

  return flags;
}

/**
 * Weighted safety score 0-100.
 * Weights: verification 0.35, holders 0.25, age 0.15, transfers 0.15, supply 0.10.
 */
export function computeTokenScore(parts: {
  verification: number;
  holders: number;
  age: number;
  transfers: number;
  supply: number;
}): number {
  return roundScore(
    parts.verification * 0.35 +
      parts.holders * 0.25 +
      parts.age * 0.15 +
      parts.transfers * 0.15 +
      parts.supply * 0.1,
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
      "No major structural red flags were raised from verification, holder concentration, age, or transfer patterns.",
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
  transfers: TokenTransfer[],
  nowMs = Date.now(),
): TokenScanResponse {
  const verification = scoreVerification(info.verified);
  const holderPart = scoreHolderConcentration(holders);
  const age = scoreTokenAge(info.creationTimeMs, nowMs);
  const transferPart = scoreTransferPatterns(transfers);
  const supplyPart = scoreSupplyMechanics(
    holders,
    transfers,
    info.creationTimeMs,
  );

  const score = computeTokenScore({
    verification,
    holders: holderPart.score,
    age,
    transfers: transferPart.score,
    supply: supplyPart.score,
  });

  const riskLevel = riskLevelFromScore(score);
  const confidence = computeTokenConfidence(info, holders, transfers);
  const flags = buildTokenFlags({
    verified: info.verified,
    top10Pct: holderPart.top10Pct,
    ageScore: age,
    transfer: transferPart,
    mintConcentration: supplyPart.mintConcentration,
    creationTimeMs: info.creationTimeMs,
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
