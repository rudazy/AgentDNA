/** Shared types for Agent DNA scans. */

export const SERVICE_NAME = "agent-dna" as const;
export const SERVICE_VERSION = "1.0.0" as const;

export type Grade =
  | "A+"
  | "A"
  | "A-"
  | "B+"
  | "B"
  | "B-"
  | "C+"
  | "C"
  | "C-"
  | "D"
  | "F";

/** Grade as displayed: a letter, or UNRATED when confidence is too low to rate. */
export type DisplayGrade = Grade | "UNRATED";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface AgentTraits {
  reliability: number;
  consistency: number;
  longevity: number;
  riskAppetite: number;
  activity: number;
  counterpartyDiversity: number;
}

export interface AgentScanResponse {
  service: typeof SERVICE_NAME;
  scan: "agent";
  address: string;
  grade: DisplayGrade;
  traits: AgentTraits;
  deliveryProbability: number;
  /** Explicit label: deliveryProbability is a heuristic estimate, not a guarantee. */
  deliveryProbabilityLabel: "heuristic estimate";
  confidence: number;
  explanation: string;
  scannedAt: string;
  version: typeof SERVICE_VERSION;
}

export interface TokenScanResponse {
  service: typeof SERVICE_NAME;
  scan: "token";
  address: string;
  score: number;
  riskLevel: RiskLevel;
  flags: string[];
  confidence: number;
  explanation: string;
  scannedAt: string;
  version: typeof SERVICE_VERSION;
}

export interface AddressSummary {
  address: string;
  /** Earliest observed activity. Limited by the data source history window. */
  firstSeenMs: number | null;
  lastSeenMs: number | null;
  /** Transactions observed within the data source history window. */
  txCount: number;
  balance: string;
  balanceSymbol: string;
  isFresh: boolean;
  /** Days of history the data source exposes; null means unlimited. */
  historyWindowDays: number | null;
  /** True when history likely extends beyond the visible window. */
  historyWindowCapped: boolean;
}

export interface NormalizedTx {
  hash: string;
  timestampMs: number;
  from: string;
  to: string;
  method: string;
  value: string;
  status: "success" | "failed" | "unknown";
  /** True when the counterparty looks like a contract that is not verified or is very new. */
  counterpartyUnverifiedOrNew?: boolean;
}

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  /** Circulating supply from the data source ("0" when unknown). */
  totalSupply: string;
  decimals: number;
  creationTimeMs: number | null;
  /** Listed on a top CEX or community verified (data source tag). */
  communityRecognized: boolean;
  /** Data source risk control level 0-5 (0 undefined); null when unavailable. */
  riskControlLevel: number | null;
  /** Data source honeypot tag. */
  honeypot: boolean;
  /** Top 10 holders share of supply in percent; null when unavailable. */
  top10HoldPercent: number | null;
  /** Developer position share of supply in percent; null when unavailable. */
  devHoldPercent: number | null;
  holderCount: number | null;
}

export interface TokenHolder {
  address: string;
  amount: string;
  percentage: number;
}

/** One DEX trade for the token. Replaces raw ERC-20 transfer rows. */
export interface TokenTrade {
  hash: string;
  timestampMs: number;
  trader: string;
  side: "buy" | "sell" | "unknown";
  amount: string;
  volumeUsd: number;
}

export interface Paging {
  page: number;
  limit: number;
  totalPage?: number;
}

export type ScanErrorCode =
  | "BAD_REQUEST"
  | "PAYMENT_REQUIRED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "UPSTREAM"
  | "INTERNAL";

export interface ErrorBody {
  error: string;
  code: ScanErrorCode;
  details?: string;
}
