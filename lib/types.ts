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
  grade: Grade;
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
  firstSeenMs: number | null;
  lastSeenMs: number | null;
  txCount: number;
  balance: string;
  balanceSymbol: string;
  isFresh: boolean;
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
  totalSupply: string;
  decimals: number;
  creationTimeMs: number | null;
  verified: boolean;
  holderCount: number | null;
}

export interface TokenHolder {
  address: string;
  amount: string;
  percentage: number;
}

export interface TokenTransfer {
  hash: string;
  timestampMs: number;
  from: string;
  to: string;
  amount: string;
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
