/**
 * Typed OKX Onchain OS Web3 API client for X Layer chain data.
 * Base: https://web3.okx.com (paths under /api/v6/)
 * Auth: OKX OS signed headers (OK-ACCESS-KEY, OK-ACCESS-SIGN, OK-ACCESS-TIMESTAMP, OK-ACCESS-PASSPHRASE)
 * Docs: https://web3.okx.com/onchainos/dev-docs/home/api-access-and-usage
 * Chain: chainIndex 196 (X Layer)
 */

import { createHmac } from "crypto";
import type {
  AddressSummary,
  NormalizedTx,
  Paging,
  TokenHolder,
  TokenInfo,
  TokenTrade,
} from "./types";

const HOST = "https://web3.okx.com";
const CHAIN_INDEX = "196";
/** The transactions-by-address endpoint only exposes about 6 months of history. */
export const HISTORY_WINDOW_DAYS = 183;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 1;
const BACKOFF_MS = 400;
/** Max records per transactions-by-address request on a single chain. */
const TX_PAGE_SIZE = 20;
const DAY_MS = 86_400_000;

export type ChainDataErrorKind =
  | "NotFound"
  | "RateLimited"
  | "Upstream"
  | "AuthFailed";

export class ChainDataError extends Error {
  constructor(
    message: string,
    readonly kind: ChainDataErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ChainDataError";
  }
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

/** Thin in-memory cache per serverless invocation (not a shared store). */
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15_000;

export interface OkxCredentials {
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

const AUTH_HELP =
  "Set OKXOS_API_KEY, OKXOS_SECRET_KEY, and OKXOS_PASSPHRASE " +
  "(legacy OKLINK_API_KEY / OKLINK_SECRET_KEY / OKLINK_PASSPHRASE are accepted as fallbacks). " +
  "Keys come from the web3.okx.com developer portal: Connect Wallet, create a project, " +
  "create an API key with a passphrase. See .env.example.";

export function getCredentials(
  env: Record<string, string | undefined> = process.env,
): OkxCredentials {
  const apiKey = (env.OKXOS_API_KEY ?? env.OKLINK_API_KEY)?.trim() ?? "";
  const secretKey = (env.OKXOS_SECRET_KEY ?? env.OKLINK_SECRET_KEY)?.trim() ?? "";
  const passphrase = (env.OKXOS_PASSPHRASE ?? env.OKLINK_PASSPHRASE)?.trim() ?? "";

  if (!apiKey || !secretKey || !passphrase) {
    throw new ChainDataError(
      `OKX OS API credentials missing. ${AUTH_HELP}`,
      "AuthFailed",
    );
  }

  return { apiKey, secretKey, passphrase };
}

/**
 * OKX OS request signature.
 * prehash = timestamp + METHOD + requestPath + body
 * OK-ACCESS-SIGN = Base64(HMAC-SHA256(prehash, secretKey))
 * requestPath includes the query string for GET; body is the raw JSON for POST.
 */
export function signOkxAccess(
  secretKey: string,
  timestamp: string,
  method: string,
  requestPath: string,
  body = "",
): string {
  const prehash = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
  return createHmac("sha256", secretKey).update(prehash, "utf8").digest("base64");
}

/** ISO-8601 UTC timestamp used for both sign prehash and OK-ACCESS-TIMESTAMP. */
export function okxAccessTimestamp(now: Date = new Date()): string {
  return now.toISOString();
}

export function buildOkxAccessHeaders(
  credentials: OkxCredentials,
  method: string,
  requestPath: string,
  body = "",
  now: Date = new Date(),
): Record<string, string> {
  const timestamp = okxAccessTimestamp(now);
  const sign = signOkxAccess(
    credentials.secretKey,
    timestamp,
    method,
    requestPath,
    body,
  );

  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": credentials.apiKey,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": credentials.passphrase,
    Accept: "application/json",
  };
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
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

interface OkxEnvelope<T> {
  code: string;
  msg: string;
  data: T;
}

/** Classify an envelope-level error code/message into a typed error. */
export function classifyEnvelopeError(code: string, msg: string): ChainDataError {
  const text = msg || `OKX OS error code ${code}`;
  if (/not found|no data|not exist|empty/i.test(text)) {
    return new ChainDataError(text, "NotFound");
  }
  if (/rate|limit|frequen|too many|quota/i.test(text)) {
    return new ChainDataError(text, "RateLimited");
  }
  if (/key|sign|passphrase|timestamp|permission|unauthor/i.test(text)) {
    return new ChainDataError(
      `OKX OS auth rejected: ${text}. ${AUTH_HELP}`,
      "AuthFailed",
    );
  }
  return new ChainDataError(text, "Upstream");
}

interface FetchOptions {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

async function okxFetch<T>(options: FetchOptions): Promise<T> {
  const credentials = getCredentials();
  const { method, path } = options;

  let requestPath = path;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) {
      if (v === undefined || v === "") continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) requestPath = `${path}?${qs}`;
  }

  const bodyString = options.body === undefined ? "" : JSON.stringify(options.body);
  const url = `${HOST}${requestPath}`;
  const cacheKey = `${method} ${url} ${bodyString}`;
  const cached = cacheGet<T>(cacheKey);
  if (cached !== undefined) return cached;

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      // Fresh timestamp/sign each attempt (30 second server skew tolerance)
      const headers = buildOkxAccessHeaders(credentials, method, requestPath, bodyString);
      const res = await fetch(url, {
        method,
        headers,
        body: bodyString || undefined,
        signal: controller.signal,
        cache: "no-store",
      });

      if (res.status === 429) {
        throw new ChainDataError("OKX OS rate limited", "RateLimited", 429);
      }

      if (res.status === 402) {
        throw new ChainDataError(
          "OKX OS monthly API quota exhausted (HTTP 402). Basic and Premium Market API " +
            "tiers include 100K free calls per month; top up or subscribe in the dev portal.",
          "RateLimited",
          402,
        );
      }

      if (res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          await sleep(BACKOFF_MS * (attempt + 1));
          continue;
        }
        throw new ChainDataError(
          `OKX OS upstream ${res.status}`,
          "Upstream",
          res.status,
        );
      }

      if (res.status === 404) {
        throw new ChainDataError("OKX OS resource not found", "NotFound", 404);
      }

      if (res.status === 401 || res.status === 403) {
        const bodyText = await res.text().catch(() => "");
        throw new ChainDataError(
          `OKX OS auth failed (${res.status}). ${AUTH_HELP} Body: ${bodyText.slice(0, 200)}`,
          "AuthFailed",
          res.status,
        );
      }

      if (!res.ok) {
        throw new ChainDataError(
          `OKX OS HTTP ${res.status}: ${await res.text().catch(() => "")}`,
          "Upstream",
          res.status,
        );
      }

      const json = (await res.json()) as OkxEnvelope<T>;
      if (json.code !== "0") {
        throw classifyEnvelopeError(json.code, json.msg);
      }

      cacheSet(cacheKey, json.data);
      return json.data;
    } catch (err) {
      lastError = err;
      if (err instanceof ChainDataError) {
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
        throw new ChainDataError("OKX OS request timed out", "Upstream");
      }
      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_MS * (attempt + 1));
        continue;
      }
      // Keep the network-level cause (e.g. getaddrinfo ENOTFOUND) diagnosable.
      const cause =
        err instanceof Error && err.cause ? ` (${String(err.cause)})` : "";
      throw new ChainDataError(
        err instanceof Error ? `${err.message}${cause}` : "OKX OS fetch failed",
        "Upstream",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ChainDataError("OKX OS fetch failed", "Upstream");
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

// --- Raw response shapes (partial; OKX OS returns stringy numbers) ---

interface RawTxEndpoint {
  address?: string;
  amount?: string;
}

interface RawTx {
  chainIndex?: string;
  txHash?: string;
  itype?: string;
  methodId?: string;
  txTime?: string;
  from?: RawTxEndpoint[];
  to?: RawTxEndpoint[];
  tokenContractAddress?: string;
  amount?: string;
  symbol?: string;
  txStatus?: string;
  hitBlacklist?: boolean;
}

interface RawTxPage {
  transactions?: RawTx[];
  transactionList?: RawTx[];
  cursor?: string;
}

interface RawTokenAsset {
  chainIndex?: string;
  tokenContractAddress?: string;
  symbol?: string;
  balance?: string;
  rawBalance?: string;
  tokenPrice?: string;
  isRiskToken?: boolean;
}

interface RawBalancePage {
  tokenAssets?: RawTokenAsset[];
}

interface RawTokenBasicInfo {
  chainIndex?: string;
  tokenContractAddress?: string;
  tokenName?: string;
  tokenSymbol?: string;
  decimal?: string;
  tagList?: { communityRecognized?: boolean };
}

interface RawTokenPriceInfo {
  chainIndex?: string;
  tokenContractAddress?: string;
  price?: string;
  marketCap?: string;
  circSupply?: string;
  liquidity?: string;
  holders?: string;
}

interface RawTokenAdvancedInfo {
  createTime?: string;
  creatorAddress?: string;
  riskControlLevel?: string;
  top10HoldPercent?: string;
  devHoldingPercent?: string;
  bundleHoldingPercent?: string;
  tokenTags?: unknown;
}

interface RawHolder {
  holderWalletAddress?: string;
  walletAddress?: string;
  holderAddress?: string;
  address?: string;
  holdAmount?: string;
  holdingAmount?: string;
  amount?: string;
  holdPercent?: string;
}

interface RawHolderPage {
  holderRankingList?: RawHolder[];
  holderList?: RawHolder[];
  list?: RawHolder[];
  cursor?: string;
}

interface RawTradeTokenInfo {
  amount?: string;
  tokenSymbol?: string;
  tokenContractAddress?: string;
}

interface RawTrade {
  id?: string;
  chainIndex?: string;
  tokenContractAddress?: string;
  txHashUrl?: string;
  userAddress?: string;
  dexName?: string;
  type?: string;
  changedTokenInfo?: RawTradeTokenInfo | RawTradeTokenInfo[];
  price?: string;
  volume?: string;
  time?: string;
}

export function mapTxStatus(raw: string | undefined): NormalizedTx["status"] {
  const s = String(raw ?? "").toLowerCase();
  if (s === "success") return "success";
  if (s === "fail" || s === "failed") return "failed";
  return "unknown";
}

export function mapTx(raw: RawTx): NormalizedTx {
  const itype = String(raw.itype ?? "");
  const methodId = raw.methodId?.trim() ?? "";
  return {
    hash: String(raw.txHash ?? ""),
    timestampMs: parseMs(raw.txTime) ?? 0,
    from: String(raw.from?.[0]?.address ?? "").toLowerCase(),
    to: String(raw.to?.[0]?.address ?? "").toLowerCase(),
    // Plain value moves (native outer/inner transfers) are labeled transfer;
    // anything with a selector keeps its methodId for downstream heuristics.
    method: methodId || (itype === "0" || itype === "1" ? "transfer" : "unknown"),
    value: String(raw.amount ?? "0"),
    status: mapTxStatus(raw.txStatus),
  };
}

interface TxWindow {
  txs: NormalizedTx[];
  /** True when more history exists past what was fetched. */
  sawMore: boolean;
}

/**
 * Assemble up to maxCount recent transactions by walking the cursor.
 * Single-chain requests return at most TX_PAGE_SIZE rows each.
 */
async function fetchTxWindow(address: string, maxCount: number): Promise<TxWindow> {
  const txs: NormalizedTx[] = [];
  let cursor = "";
  let sawMore = false;
  const maxRequests = Math.ceil(maxCount / TX_PAGE_SIZE);

  for (let i = 0; i < maxRequests; i++) {
    const page = await okxFetch<RawTxPage[]>({
      method: "GET",
      path: "/api/v6/dex/post-transaction/transactions-by-address",
      query: {
        address,
        chains: CHAIN_INDEX,
        limit: TX_PAGE_SIZE,
        cursor: cursor || undefined,
      },
    });

    const row = Array.isArray(page) ? page[0] : undefined;
    const list = row?.transactions ?? row?.transactionList ?? [];
    for (const raw of list) {
      txs.push(mapTx(raw));
      if (txs.length >= maxCount) break;
    }

    cursor = String(row?.cursor ?? "");
    if (txs.length >= maxCount) {
      sawMore = Boolean(cursor) || list.length >= TX_PAGE_SIZE;
      break;
    }
    if (!cursor || list.length === 0) break;
  }

  return { txs, sawMore };
}

/**
 * Address summary composed from token balances plus the visible tx window.
 * Fresh addresses (zero visible history and balance) are first-class results.
 * There is no since-genesis summary endpoint on OKX OS; firstSeenMs and txCount
 * only cover HISTORY_WINDOW_DAYS and historyWindowCapped marks saturation.
 */
export async function getAddressSummary(address: string): Promise<AddressSummary> {
  let balance = "0";
  let balanceSymbol = "OKB";
  try {
    const data = await okxFetch<RawBalancePage[]>({
      method: "GET",
      path: "/api/v6/dex/balance/all-token-balances-by-address",
      query: { address, chains: CHAIN_INDEX },
    });
    const assets = (Array.isArray(data) ? data[0]?.tokenAssets : undefined) ?? [];
    const native = assets.find((a) => !a.tokenContractAddress);
    if (native) {
      balance = native.balance ?? "0";
      balanceSymbol = native.symbol ?? "OKB";
    }
  } catch (err) {
    if (!(err instanceof ChainDataError && err.kind === "NotFound")) {
      throw err;
    }
  }

  let window: TxWindow = { txs: [], sawMore: false };
  try {
    window = await fetchTxWindow(address, 100);
  } catch (err) {
    if (!(err instanceof ChainDataError && err.kind === "NotFound")) {
      throw err;
    }
  }

  const times = window.txs.map((t) => t.timestampMs).filter((t) => t > 0);
  const firstSeenMs = times.length > 0 ? Math.min(...times) : null;
  const lastSeenMs = times.length > 0 ? Math.max(...times) : null;
  const txCount = window.txs.length;
  const nearWindowEdge =
    firstSeenMs !== null &&
    Date.now() - firstSeenMs >= (HISTORY_WINDOW_DAYS - 30) * DAY_MS;

  return {
    address,
    firstSeenMs,
    lastSeenMs,
    txCount,
    balance,
    balanceSymbol,
    isFresh: txCount === 0 && parseFloatSafe(balance, 0) === 0,
    historyWindowDays: HISTORY_WINDOW_DAYS,
    historyWindowCapped: window.sawMore || nearWindowEdge,
  };
}

/** Normalized transaction list. Paging is emulated over the cursor API. */
export async function getAddressTransactions(
  address: string,
  paging: Paging = { page: 1, limit: 100 },
): Promise<{ txs: NormalizedTx[]; paging: Paging }> {
  try {
    const window = await fetchTxWindow(address, Math.min(paging.limit, 100));
    return {
      txs: window.txs,
      paging: {
        page: 1,
        limit: paging.limit,
        totalPage: window.txs.length > 0 ? 1 : 0,
      },
    };
  } catch (err) {
    if (err instanceof ChainDataError && err.kind === "NotFound") {
      return { txs: [], paging: { ...paging, totalPage: 0 } };
    }
    throw err;
  }
}

function scanForHoneypot(tokenTags: unknown): boolean {
  if (!tokenTags) return false;
  const entries = Array.isArray(tokenTags) ? tokenTags : [tokenTags];
  for (const entry of entries) {
    if (typeof entry === "string" && /honeypot/i.test(entry)) return true;
    if (entry && typeof entry === "object" && "honeypot" in entry) return true;
  }
  return false;
}

function emptyTokenInfo(address: string): TokenInfo {
  return {
    address,
    name: "Unknown",
    symbol: "UNKNOWN",
    totalSupply: "0",
    decimals: 18,
    creationTimeMs: null,
    communityRecognized: false,
    riskControlLevel: null,
    honeypot: false,
    top10HoldPercent: null,
    devHoldPercent: null,
    holderCount: null,
  };
}

/**
 * Token metadata + risk signals, composed from basic-info, price-info,
 * and advanced-info. Contract source verification is not exposed by OKX OS;
 * communityRecognized and riskControlLevel are the available trust signals.
 * Premium endpoints degrade to nulls instead of failing the whole scan.
 */
export async function getTokenInfo(address: string): Promise<TokenInfo> {
  const info = emptyTokenInfo(address);
  const tokenBody = [
    { chainIndex: CHAIN_INDEX, tokenContractAddress: address.toLowerCase() },
  ];

  try {
    const data = await okxFetch<RawTokenBasicInfo[]>({
      method: "POST",
      path: "/api/v6/dex/market/token/basic-info",
      body: tokenBody,
    });
    const row = Array.isArray(data) ? data[0] : undefined;
    if (row) {
      info.name = row.tokenName ?? info.name;
      info.symbol = row.tokenSymbol ?? info.symbol;
      info.decimals = parseIntSafe(row.decimal, 18);
      info.communityRecognized = Boolean(row.tagList?.communityRecognized);
    }
  } catch (err) {
    if (!(err instanceof ChainDataError && err.kind === "NotFound")) {
      throw err;
    }
  }

  try {
    const data = await okxFetch<RawTokenPriceInfo[]>({
      method: "POST",
      path: "/api/v6/dex/market/price-info",
      body: tokenBody,
    });
    const row = Array.isArray(data) ? data[0] : undefined;
    if (row) {
      info.totalSupply = row.circSupply ?? info.totalSupply;
      info.holderCount = row.holders ? parseIntSafe(row.holders) : info.holderCount;
    }
  } catch (err) {
    if (err instanceof ChainDataError && (err.kind === "AuthFailed" || err.kind === "RateLimited")) {
      throw err;
    }
    // NotFound / Upstream: supply and holder count stay unknown.
  }

  const advanced = await fetchTokenAdvancedInfo(address);
  if (advanced) {
    info.creationTimeMs = parseMs(advanced.createTime);
    info.riskControlLevel = advanced.riskControlLevel
      ? parseIntSafe(advanced.riskControlLevel)
      : advanced.riskControlLevel === "0"
        ? 0
        : null;
    info.honeypot = scanForHoneypot(advanced.tokenTags);
    info.top10HoldPercent = normalizePercent(advanced.top10HoldPercent);
    info.devHoldPercent = normalizePercent(advanced.devHoldingPercent);
  }

  return info;
}

/**
 * The advanced-info docs page does not render its HTTP verb; siblings
 * basic-info and price-info are POST, so POST is tried first with a
 * single GET fallback. The smoke script confirms the working verb live.
 */
async function fetchTokenAdvancedInfo(
  address: string,
): Promise<RawTokenAdvancedInfo | null> {
  const path = "/api/v6/dex/market/token/advanced-info";
  const lower = address.toLowerCase();

  try {
    const data = await okxFetch<RawTokenAdvancedInfo[]>({
      method: "POST",
      path,
      body: [{ chainIndex: CHAIN_INDEX, tokenContractAddress: lower }],
    });
    return (Array.isArray(data) ? data[0] : undefined) ?? null;
  } catch (err) {
    if (err instanceof ChainDataError && (err.kind === "AuthFailed" || err.kind === "RateLimited")) {
      throw err;
    }
    // Fall through to GET on NotFound / Upstream (covers a wrong-verb 404/405).
  }

  try {
    const data = await okxFetch<RawTokenAdvancedInfo[]>({
      method: "GET",
      path,
      query: { chainIndex: CHAIN_INDEX, tokenContractAddress: lower },
    });
    return (Array.isArray(data) ? data[0] : undefined) ?? null;
  } catch (err) {
    if (err instanceof ChainDataError && (err.kind === "AuthFailed" || err.kind === "RateLimited")) {
      throw err;
    }
    return null;
  }
}

/** Interpret a percent-ish string; values at or below 1 are treated as fractions. */
export function normalizePercent(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = parseFloatSafe(value, NaN);
  if (!Number.isFinite(n) || n < 0) return null;
  return n <= 1 ? n * 100 : n;
}

/** Normalize holder rows; percent convention (fraction vs percent) is auto-detected. */
export function mapHolders(rows: RawHolder[]): TokenHolder[] {
  const holders = rows.map((h) => ({
    address: String(
      h.holderWalletAddress ?? h.walletAddress ?? h.holderAddress ?? h.address ?? "",
    ).toLowerCase(),
    amount: String(h.holdAmount ?? h.holdingAmount ?? h.amount ?? "0"),
    percentage: parseFloatSafe(h.holdPercent, 0),
  }));

  const sum = holders.reduce((acc, h) => acc + h.percentage, 0);
  if (holders.length > 0 && sum > 0 && sum <= 1.5) {
    // Source reported fractions of 1 rather than percents.
    return holders.map((h) => ({ ...h, percentage: h.percentage * 100 }));
  }
  return holders;
}

/** Top holders with percentages. Empty list is a valid result. */
export async function getTokenHolders(
  address: string,
  paging: Paging = { page: 1, limit: 20 },
): Promise<{ holders: TokenHolder[]; paging: Paging }> {
  try {
    const data = await okxFetch<RawHolderPage[]>({
      method: "GET",
      path: "/api/v6/dex/market/token/holder",
      query: {
        chainIndex: CHAIN_INDEX,
        tokenContractAddress: address.toLowerCase(),
        limit: Math.min(paging.limit, 100),
      },
    });
    const row = Array.isArray(data) ? data[0] : undefined;
    const rawRows = Array.isArray(data) && !row?.holderRankingList && !row?.holderList && !row?.list
      ? (data as unknown as RawHolder[])
      : row?.holderRankingList ?? row?.holderList ?? row?.list ?? [];
    const holders = mapHolders(rawRows.filter((r) => r && typeof r === "object"));
    return {
      holders: holders.filter((h) => h.address),
      paging: { page: 1, limit: paging.limit, totalPage: holders.length > 0 ? 1 : 0 },
    };
  } catch (err) {
    if (err instanceof ChainDataError && (err.kind === "NotFound" || err.kind === "Upstream")) {
      return { holders: [], paging: { ...paging, totalPage: 0 } };
    }
    throw err;
  }
}

const TX_HASH_RE = /0x[0-9a-fA-F]{64}/;

export function mapTrade(raw: RawTrade): TokenTrade {
  const hashMatch = TX_HASH_RE.exec(String(raw.txHashUrl ?? ""));
  const changed = Array.isArray(raw.changedTokenInfo)
    ? raw.changedTokenInfo[0]
    : raw.changedTokenInfo;
  const type = String(raw.type ?? "").toLowerCase();
  return {
    hash: hashMatch?.[0] ?? String(raw.id ?? ""),
    timestampMs: parseMs(raw.time) ?? 0,
    trader: String(raw.userAddress ?? "").toLowerCase(),
    side: type === "buy" || type === "sell" ? type : "unknown",
    amount: String(changed?.amount ?? "0"),
    volumeUsd: parseFloatSafe(raw.volume, 0),
  };
}

/** Recent DEX trade activity for the token (replaces raw transfer lists). */
export async function getTokenTrades(
  address: string,
  paging: Paging = { page: 1, limit: 100 },
): Promise<{ trades: TokenTrade[]; paging: Paging }> {
  try {
    const data = await okxFetch<RawTrade[]>({
      method: "GET",
      path: "/api/v6/dex/market/trades",
      query: {
        chainIndex: CHAIN_INDEX,
        tokenContractAddress: address.toLowerCase(),
        limit: Math.min(paging.limit, 500),
      },
    });
    const rows = Array.isArray(data) ? data : [];
    const trades = rows.map(mapTrade).filter((t) => t.trader || t.hash);
    return {
      trades,
      paging: { page: 1, limit: paging.limit, totalPage: trades.length > 0 ? 1 : 0 },
    };
  } catch (err) {
    if (err instanceof ChainDataError && (err.kind === "NotFound" || err.kind === "Upstream")) {
      return { trades: [], paging: { ...paging, totalPage: 0 } };
    }
    throw err;
  }
}
