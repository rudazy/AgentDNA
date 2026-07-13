/**
 * Typed OKLink X Layer explorers.
 * Base: https://www.oklink.com/api/v5/explorer
 * Auth: Ok-Access-Key header
 * Chain: XLAYER
 */

import type {
  AddressSummary,
  NormalizedTx,
  Paging,
  TokenHolder,
  TokenInfo,
  TokenTransfer,
} from "./types";

const BASE_URL = "https://www.oklink.com/api/v5/explorer";
const CHAIN = "XLAYER";
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 1;
const BACKOFF_MS = 400;

export class OklinkError extends Error {
  constructor(
    message: string,
    readonly kind: "NotFound" | "RateLimited" | "Upstream" | "Config",
    readonly status?: number,
  ) {
    super(message);
    this.name = "OklinkError";
  }
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

/** Thin in-memory cache per serverless invocation (not a shared store). */
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15_000;

function getApiKey(): string {
  const key = process.env.OKLINK_API_KEY?.trim();
  if (!key) {
    throw new OklinkError(
      "OKLINK_API_KEY is not set. Add it to .env.local (see .env.example).",
      "Config",
    );
  }
  return key;
}

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

interface OklinkEnvelope<T> {
  code: string;
  msg: string;
  data: T;
}

async function oklinkFetch<T>(
  path: string,
  query: Record<string, string | number | undefined>,
): Promise<T> {
  const apiKey = getApiKey();
  const params = new URLSearchParams();
  params.set("chainShortName", CHAIN);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue;
    params.set(k, String(v));
  }

  const url = `${BASE_URL}${path}?${params.toString()}`;
  const cacheKey = url;
  const cached = cacheGet<T>(cacheKey);
  if (cached !== undefined) return cached;

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "Ok-Access-Key": apiKey,
          Accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      });

      if (res.status === 429) {
        throw new OklinkError("OKLink rate limited", "RateLimited", 429);
      }

      if (res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          await sleep(BACKOFF_MS * (attempt + 1));
          continue;
        }
        throw new OklinkError(
          `OKLink upstream ${res.status}`,
          "Upstream",
          res.status,
        );
      }

      if (res.status === 404) {
        throw new OklinkError("OKLink resource not found", "NotFound", 404);
      }

      if (!res.ok) {
        throw new OklinkError(
          `OKLink HTTP ${res.status}: ${await res.text().catch(() => "")}`,
          "Upstream",
          res.status,
        );
      }

      const json = (await res.json()) as OklinkEnvelope<T>;
      if (json.code !== "0" && json.code !== "00000") {
        const msg = json.msg || "OKLink error";
        if (/not found|no data|empty/i.test(msg)) {
          throw new OklinkError(msg, "NotFound");
        }
        if (/rate|limit|too many/i.test(msg)) {
          throw new OklinkError(msg, "RateLimited");
        }
        throw new OklinkError(msg, "Upstream");
      }

      cacheSet(cacheKey, json.data);
      return json.data;
    } catch (err) {
      lastError = err;
      if (err instanceof OklinkError) {
        if (err.kind === "Upstream" && attempt < MAX_RETRIES) {
          await sleep(BACKOFF_MS * (attempt + 1));
          continue;
        }
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        if (attempt < MAX_RETRIES) {
          await sleep(BACKOFF_MS * (attempt + 1));
          continue;
        }
        throw new OklinkError("OKLink request timed out", "Upstream");
      }
      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_MS * (attempt + 1));
        continue;
      }
      throw new OklinkError(
        err instanceof Error ? err.message : "OKLink fetch failed",
        "Upstream",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new OklinkError("OKLink fetch failed", "Upstream");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  const s = String(value);
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n < 1e12 ? n * 1000 : n;
  }
  const d = Date.parse(s);
  return Number.isNaN(d) ? null : d;
}

function parseIntSafe(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseFloatSafe(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

// --- Raw response shapes (partial; OKLink returns stringy numbers) ---

interface RawAddressSummary {
  address?: string;
  balance?: string;
  balanceSymbol?: string;
  transactionCount?: string;
  firstTransactionTime?: string;
  lastTransactionTime?: string;
  verifying?: string;
}

interface RawTx {
  txId?: string;
  txHash?: string;
  hash?: string;
  transactionTime?: string;
  blocktime?: string;
  from?: string;
  to?: string;
  method?: string;
  methodId?: string;
  amount?: string;
  value?: string;
  state?: string;
  status?: string;
  isError?: string | number | boolean;
}

interface RawTxPage {
  page?: string;
  limit?: string;
  totalPage?: string;
  transactionList?: RawTx[];
  transactionLists?: RawTx[];
}

interface RawTokenInfo {
  symbol?: string;
  token?: string;
  tokenFullName?: string;
  totalSupply?: string;
  precision?: string;
  tokenContractAddress?: string;
  holderCount?: string;
  holders?: string;
  createTime?: string;
  firstTransactionTime?: string;
}

interface RawTokenListPage {
  tokenList?: RawTokenInfo[];
  page?: string;
  limit?: string;
  totalPage?: string;
}

interface RawHolder {
  holderAddress?: string;
  address?: string;
  amount?: string;
  holdingAmount?: string;
  percentage?: string;
  rank?: string;
}

interface RawHolderPage {
  positionList?: RawHolder[];
  holderList?: RawHolder[];
  list?: RawHolder[];
  page?: string;
  limit?: string;
  totalPage?: string;
}

interface RawTransfer {
  txId?: string;
  txHash?: string;
  transactionTime?: string;
  from?: string;
  to?: string;
  amount?: string;
  value?: string;
}

interface RawTransferPage {
  transactionList?: RawTransfer[];
  transferList?: RawTransfer[];
  page?: string;
  limit?: string;
  totalPage?: string;
}

function normalizeStatus(raw: RawTx): NormalizedTx["status"] {
  const state = String(raw.state ?? raw.status ?? "").toLowerCase();
  if (raw.isError === 1 || raw.isError === "1" || raw.isError === true) {
    return "failed";
  }
  if (
    state === "success" ||
    state === "1" ||
    state === "ok" ||
    state === "confirmed"
  ) {
    return "success";
  }
  if (
    state === "fail" ||
    state === "failed" ||
    state === "0" ||
    state === "error"
  ) {
    return "failed";
  }
  return "unknown";
}

function mapTx(raw: RawTx): NormalizedTx {
  const ts =
    parseMs(raw.transactionTime) ?? parseMs(raw.blocktime) ?? Date.now();
  return {
    hash: String(raw.txId ?? raw.txHash ?? raw.hash ?? ""),
    timestampMs: ts,
    from: String(raw.from ?? "").toLowerCase(),
    to: String(raw.to ?? "").toLowerCase(),
    method: String(raw.method ?? raw.methodId ?? "unknown"),
    value: String(raw.amount ?? raw.value ?? "0"),
    status: normalizeStatus(raw),
  };
}

/**
 * Address summary: first seen, tx count, balance.
 * Fresh addresses (zero history) are first-class results, not errors.
 */
export async function getAddressSummary(
  address: string,
): Promise<AddressSummary> {
  try {
    const data = await oklinkFetch<RawAddressSummary[]>(
      "/address/address-summary",
      { address },
    );
    const row = Array.isArray(data) ? data[0] : undefined;
    if (!row) {
      return freshSummary(address);
    }
    const txCount = parseIntSafe(row.transactionCount, 0);
    const firstSeenMs = parseMs(row.firstTransactionTime);
    const lastSeenMs = parseMs(row.lastTransactionTime);
    return {
      address: row.address ?? address,
      firstSeenMs,
      lastSeenMs,
      txCount,
      balance: row.balance ?? "0",
      balanceSymbol: row.balanceSymbol ?? "OKB",
      isFresh: txCount === 0 && firstSeenMs === null,
    };
  } catch (err) {
    if (err instanceof OklinkError && err.kind === "NotFound") {
      return freshSummary(address);
    }
    throw err;
  }
}

function freshSummary(address: string): AddressSummary {
  return {
    address,
    firstSeenMs: null,
    lastSeenMs: null,
    txCount: 0,
    balance: "0",
    balanceSymbol: "OKB",
    isFresh: true,
  };
}

/** Normalized transaction list with paging. */
export async function getAddressTransactions(
  address: string,
  paging: Paging = { page: 1, limit: 100 },
): Promise<{ txs: NormalizedTx[]; paging: Paging }> {
  try {
    const data = await oklinkFetch<RawTxPage[]>(
      "/address/normal-transaction-list",
      {
        address,
        page: paging.page,
        limit: Math.min(paging.limit, 100),
      },
    );
    const page = Array.isArray(data) ? data[0] : undefined;
    const list = page?.transactionList ?? page?.transactionLists ?? [];
    return {
      txs: list.map(mapTx),
      paging: {
        page: parseIntSafe(page?.page, paging.page),
        limit: parseIntSafe(page?.limit, paging.limit),
        totalPage: parseIntSafe(page?.totalPage, 1),
      },
    };
  } catch (err) {
    if (err instanceof OklinkError && err.kind === "NotFound") {
      return { txs: [], paging: { ...paging, totalPage: 0 } };
    }
    throw err;
  }
}

/** Token metadata + verification status. */
export async function getTokenInfo(address: string): Promise<TokenInfo> {
  let verified = false;
  try {
    const verifyData = await oklinkFetch<
      Array<{ contractName?: string; sourceCode?: string }>
    >("/contract/verify-contract-info", { contractAddress: address });
    const row = Array.isArray(verifyData) ? verifyData[0] : undefined;
    verified = Boolean(row?.contractName || row?.sourceCode);
  } catch {
    verified = false;
  }

  try {
    const data = await oklinkFetch<RawTokenListPage[]>(
      "/token/token-list",
      {
        protocolType: "token_20",
        tokenContractAddress: address,
        page: 1,
        limit: 1,
      },
    );
    const page = Array.isArray(data) ? data[0] : undefined;
    const token = page?.tokenList?.[0];
    if (!token) {
      return {
        address,
        name: "Unknown",
        symbol: "UNKNOWN",
        totalSupply: "0",
        decimals: 18,
        creationTimeMs: null,
        verified,
        holderCount: null,
      };
    }
    return {
      address: token.tokenContractAddress ?? address,
      name: token.tokenFullName ?? token.token ?? "Unknown",
      symbol: token.symbol ?? token.token ?? "UNKNOWN",
      totalSupply: token.totalSupply ?? "0",
      decimals: parseIntSafe(token.precision, 18),
      creationTimeMs:
        parseMs(token.createTime) ?? parseMs(token.firstTransactionTime),
      verified,
      holderCount: token.holderCount
        ? parseIntSafe(token.holderCount)
        : token.holders
          ? parseIntSafe(token.holders)
          : null,
    };
  } catch (err) {
    if (err instanceof OklinkError && err.kind === "NotFound") {
      return {
        address,
        name: "Unknown",
        symbol: "UNKNOWN",
        totalSupply: "0",
        decimals: 18,
        creationTimeMs: null,
        verified,
        holderCount: null,
      };
    }
    throw err;
  }
}

/**
 * Top holders with percentages.
 * Tries position-list then holder-list; empty list is a valid result.
 */
export async function getTokenHolders(
  address: string,
  paging: Paging = { page: 1, limit: 20 },
): Promise<{ holders: TokenHolder[]; paging: Paging }> {
  const paths = [
    "/token/position-list",
    "/token/holder-list",
    "/token/token-holder-list",
  ];

  for (const path of paths) {
    try {
      const data = await oklinkFetch<RawHolderPage[]>(path, {
        tokenContractAddress: address,
        page: paging.page,
        limit: Math.min(paging.limit, 50),
      });
      const page = Array.isArray(data) ? data[0] : undefined;
      if (!page) continue;
      const list =
        page.positionList ?? page.holderList ?? page.list ?? [];
      if (list.length === 0 && !page.page) continue;

      const holders = list.map((h) => ({
        address: String(h.holderAddress ?? h.address ?? "").toLowerCase(),
        amount: String(h.amount ?? h.holdingAmount ?? "0"),
        percentage: parseFloatSafe(h.percentage, 0),
      }));

      // If percentages missing, derive from amounts when possible.
      const sum = holders.reduce(
        (acc, h) => acc + parseFloatSafe(h.amount, 0),
        0,
      );
      const normalized =
        sum > 0
          ? holders.map((h) => ({
              ...h,
              percentage:
                h.percentage > 0
                  ? h.percentage
                  : (parseFloatSafe(h.amount, 0) / sum) * 100,
            }))
          : holders;

      return {
        holders: normalized,
        paging: {
          page: parseIntSafe(page.page, paging.page),
          limit: parseIntSafe(page.limit, paging.limit),
          totalPage: parseIntSafe(page.totalPage, 1),
        },
      };
    } catch (err) {
      if (err instanceof OklinkError && err.kind === "NotFound") {
        continue;
      }
      if (err instanceof OklinkError && err.kind === "Upstream") {
        continue;
      }
      throw err;
    }
  }

  return { holders: [], paging: { ...paging, totalPage: 0 } };
}

/** Recent token transfer activity. */
export async function getTokenTransfers(
  address: string,
  paging: Paging = { page: 1, limit: 100 },
): Promise<{ transfers: TokenTransfer[]; paging: Paging }> {
  const paths = [
    "/token/token-transaction-list",
    "/token/transaction-list",
  ];

  for (const path of paths) {
    try {
      const data = await oklinkFetch<RawTransferPage[]>(path, {
        tokenContractAddress: address,
        page: paging.page,
        limit: Math.min(paging.limit, 100),
      });
      const page = Array.isArray(data) ? data[0] : undefined;
      if (!page) continue;
      const list = page.transactionList ?? page.transferList ?? [];
      const transfers = list.map((t) => ({
        hash: String(t.txId ?? t.txHash ?? ""),
        timestampMs: parseMs(t.transactionTime) ?? 0,
        from: String(t.from ?? "").toLowerCase(),
        to: String(t.to ?? "").toLowerCase(),
        amount: String(t.amount ?? t.value ?? "0"),
      }));
      return {
        transfers,
        paging: {
          page: parseIntSafe(page.page, paging.page),
          limit: parseIntSafe(page.limit, paging.limit),
          totalPage: parseIntSafe(page.totalPage, 1),
        },
      };
    } catch (err) {
      if (err instanceof OklinkError && (err.kind === "NotFound" || err.kind === "Upstream")) {
        continue;
      }
      throw err;
    }
  }

  // Fallback: address token txs for the contract as recipient filter is not available.
  try {
    const data = await oklinkFetch<RawTxPage[]>(
      "/address/token-transaction-list",
      {
        address,
        page: paging.page,
        limit: Math.min(paging.limit, 100),
        protocolType: "token_20",
      },
    );
    const page = Array.isArray(data) ? data[0] : undefined;
    const list = page?.transactionList ?? page?.transactionLists ?? [];
    return {
      transfers: list.map((t) => ({
        hash: String(t.txId ?? t.txHash ?? t.hash ?? ""),
        timestampMs: parseMs(t.transactionTime) ?? 0,
        from: String(t.from ?? "").toLowerCase(),
        to: String(t.to ?? "").toLowerCase(),
        amount: String(t.amount ?? t.value ?? "0"),
      })),
      paging: {
        page: parseIntSafe(page?.page, paging.page),
        limit: parseIntSafe(page?.limit, paging.limit),
        totalPage: parseIntSafe(page?.totalPage, 1),
      },
    };
  } catch {
    return { transfers: [], paging: { ...paging, totalPage: 0 } };
  }
}
