/**
 * HTTP-free scan orchestration. Callable from paid routes and the playground.
 */

import {
  ChainDataError,
  getAddressSummary,
  getAddressTransactions,
  getTokenHolders,
  getTokenInfo,
  getTokenTrades,
  HISTORY_WINDOW_DAYS,
} from "./chaindata";
import { computeAgentDna } from "./dna";
import { computeTokenScan } from "./tokenscan";
import type { AgentScanResponse, TokenScanResponse } from "./types";

export type ScanKind = "agent" | "token";

export class ScanServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: "NOT_FOUND" | "RATE_LIMITED" | "UPSTREAM" | "CONFIG" | "INTERNAL",
    readonly details?: string,
  ) {
    super(message);
    this.name = "ScanServiceError";
  }
}

function mapChainDataError(err: ChainDataError): ScanServiceError {
  if (err.kind === "AuthFailed") {
    return new ScanServiceError("Chain data unavailable", 503, "CONFIG", err.message);
  }
  if (err.kind === "RateLimited") {
    return new ScanServiceError("Upstream rate limited", 429, "RATE_LIMITED", err.message);
  }
  if (err.kind === "NotFound") {
    return new ScanServiceError("Not found", 404, "NOT_FOUND", err.message);
  }
  return new ScanServiceError("Upstream chain data error", 502, "UPSTREAM", err.message);
}

/** Run Agent Scan scoring from an X Layer address. */
export async function runAgentScan(
  address: `0x${string}`,
): Promise<AgentScanResponse> {
  try {
    const summary = await getAddressSummary(address);
    const { txs } = await getAddressTransactions(address, {
      page: 1,
      limit: 100,
    });

    for (const tx of txs) {
      const method = tx.method.toLowerCase();
      if (
        method === "0x" ||
        method === "unknown" ||
        (method.startsWith("0x") && method.length === 10)
      ) {
        tx.counterpartyUnverifiedOrNew = true;
      }
    }

    return computeAgentDna(address, summary, txs);
  } catch (err) {
    if (err instanceof ChainDataError) {
      if (err.kind === "NotFound") {
        return computeAgentDna(
          address,
          {
            address,
            firstSeenMs: null,
            lastSeenMs: null,
            txCount: 0,
            balance: "0",
            balanceSymbol: "OKB",
            isFresh: true,
            historyWindowDays: HISTORY_WINDOW_DAYS,
            historyWindowCapped: false,
          },
          [],
        );
      }
      throw mapChainDataError(err);
    }
    throw err;
  }
}

/** Run Token Scan scoring from a token contract address. */
export async function runTokenScan(
  address: `0x${string}`,
): Promise<TokenScanResponse> {
  try {
    const [info, holdersPage, tradesPage] = await Promise.all([
      getTokenInfo(address),
      getTokenHolders(address, { page: 1, limit: 20 }),
      getTokenTrades(address, { page: 1, limit: 100 }),
    ]);

    return computeTokenScan(
      address,
      info,
      holdersPage.holders,
      tradesPage.trades,
    );
  } catch (err) {
    if (err instanceof ChainDataError) {
      throw mapChainDataError(err);
    }
    throw err;
  }
}
