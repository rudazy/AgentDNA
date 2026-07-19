/**
 * x402 buyer client: pays other ASPs per call from Foreman's own operational float.
 *
 * Custody line: only the float wallet's funds ever move here. Caller funds are
 * never held or forwarded. The inbound dispatch fee is revenue settled by the
 * seller-side gate in lib/x402-server.ts; this module signs nothing except the
 * float wallet's own outgoing service payments.
 *
 * Flow (x402 v2, exact scheme, USDT0 on X Layer eip155:196):
 *   1. POST the request unpaid, expect 402 with a PAYMENT-REQUIRED header
 *   2. Select the exact/eip155:196/USDT0 accepts entry, enforce spend caps
 *   3. Sign an EIP-3009 payment payload with FOREMAN_FLOAT_PRIVATE_KEY
 *   4. Retry with the PAYMENT-SIGNATURE header
 *   5. Decode the PAYMENT-RESPONSE settlement header into a receipt
 */

import type {
  PaymentRequired,
  PaymentRequirements,
} from "@okxweb3/x402-core/types";
import { USDT0_ADDRESS, X_LAYER_NETWORK } from "./constants";

export const USDT0_DECIMALS = 6;
const MICRO = 10n ** BigInt(USDT0_DECIMALS);

export const SPEND_DEFAULTS = {
  perSubcall: "0.10",
  perJob: "0.35",
  perDay: "5.00",
} as const;

const DEFAULT_SUBCALL_TIMEOUT_MS = 20_000;
const RETRY_BACKOFF_MS = 500;

export type HirerErrorKind =
  | "Config"
  | "SpendLimit"
  | "PriceMismatch"
  | "PayeeBlocked"
  | "PaymentFailed"
  | "ServiceFailed";

export class HirerError extends Error {
  constructor(
    message: string,
    readonly kind: HirerErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HirerError";
  }
}

/** Parse a decimal USDT0 amount ("0.10") into micro units. Null when malformed. */
export function parseUsdtToMicro(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const parts = trimmed.split(".");
  const whole = parts[0] ?? "0";
  const frac = parts[1] ?? "";
  return BigInt(whole) * MICRO + BigInt(frac.padEnd(USDT0_DECIMALS, "0"));
}

/** Render micro units back to a plain decimal string (no trailing zeros). */
export function microToUsdt(micro: bigint): string {
  const whole = micro / MICRO;
  const frac = (micro % MICRO).toString().padStart(USDT0_DECIMALS, "0");
  const trimmedFrac = frac.replace(/0+$/, "");
  return trimmedFrac ? `${whole}.${trimmedFrac}` : whole.toString();
}

export interface SpendLimits {
  perSubcallMicro: bigint;
  perJobMicro: bigint;
  perDayMicro: bigint;
}

function limitFromEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: string,
): bigint {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") {
    const parsed = parseUsdtToMicro(fallback);
    if (parsed === null) throw new HirerError(`Bad default for ${name}`, "Config");
    return parsed;
  }
  const parsed = parseUsdtToMicro(raw);
  if (parsed === null) {
    throw new HirerError(
      `${name} must be a plain decimal USDT0 amount (max 6 decimals), got "${raw}"`,
      "Config",
    );
  }
  return parsed;
}

export function getSpendLimits(
  env: Record<string, string | undefined> = process.env,
): SpendLimits {
  return {
    perSubcallMicro: limitFromEnv(env, "MAX_SPEND_PER_SUBCALL", SPEND_DEFAULTS.perSubcall),
    perJobMicro: limitFromEnv(env, "MAX_SPEND_PER_JOB", SPEND_DEFAULTS.perJob),
    perDayMicro: limitFromEnv(env, "MAX_SPEND_PER_DAY", SPEND_DEFAULTS.perDay),
  };
}

export function isDryRun(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const v = env.FOREMAN_DRY_RUN?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/**
 * Rolling per-UTC-day spend ledger.
 * SERVERLESS CAVEAT: in-memory per isolate, same as lib/ratelimit.ts. A cold
 * start resets the counter; the per-job cap still bounds any single request.
 */
export class DaySpendLedger {
  private day = "";
  private spentMicro = 0n;

  constructor(private readonly now: () => Date = () => new Date()) {}

  private roll(): void {
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.spentMicro = 0n;
    }
  }

  get spent(): bigint {
    this.roll();
    return this.spentMicro;
  }

  add(amountMicro: bigint): void {
    this.roll();
    this.spentMicro += amountMicro;
  }

  subtract(amountMicro: bigint): void {
    this.roll();
    this.spentMicro -= amountMicro;
    if (this.spentMicro < 0n) this.spentMicro = 0n;
  }
}

const globalDayLedger = new DaySpendLedger();

export function getGlobalDayLedger(): DaySpendLedger {
  return globalDayLedger;
}

export type SpendScope = "subcall" | "job" | "day";

export interface SpendRefusal {
  ok: false;
  scope: SpendScope;
  message: string;
}

export type SpendDecision = { ok: true } | SpendRefusal;

/**
 * Per-job spend controller. reserve() is synchronous (check plus add in one
 * tick), so parallel subtasks in one job cannot race past a cap. release()
 * undoes a reservation when no payment header was ever sent.
 */
export class SpendController {
  private jobSpentMicro = 0n;
  readonly jobCapMicro: bigint;

  constructor(
    readonly limits: SpendLimits,
    private readonly dayLedger: DaySpendLedger,
    jobBudgetMicro?: bigint,
  ) {
    this.jobCapMicro =
      jobBudgetMicro !== undefined && jobBudgetMicro < limits.perJobMicro
        ? jobBudgetMicro
        : limits.perJobMicro;
  }

  get jobSpent(): bigint {
    return this.jobSpentMicro;
  }

  check(amountMicro: bigint): SpendDecision {
    if (amountMicro <= 0n) {
      return { ok: false, scope: "subcall", message: "Amount must be positive" };
    }
    if (amountMicro > this.limits.perSubcallMicro) {
      return {
        ok: false,
        scope: "subcall",
        message:
          `Subcall price ${microToUsdt(amountMicro)} USDT0 exceeds MAX_SPEND_PER_SUBCALL ` +
          `${microToUsdt(this.limits.perSubcallMicro)}`,
      };
    }
    if (this.jobSpentMicro + amountMicro > this.jobCapMicro) {
      return {
        ok: false,
        scope: "job",
        message:
          `Job spend ${microToUsdt(this.jobSpentMicro + amountMicro)} USDT0 would exceed ` +
          `the job cap ${microToUsdt(this.jobCapMicro)}`,
      };
    }
    if (this.dayLedger.spent + amountMicro > this.limits.perDayMicro) {
      return {
        ok: false,
        scope: "day",
        message:
          `Daily spend would exceed MAX_SPEND_PER_DAY ` +
          `${microToUsdt(this.limits.perDayMicro)} USDT0`,
      };
    }
    return { ok: true };
  }

  reserve(amountMicro: bigint): SpendDecision {
    const decision = this.check(amountMicro);
    if (!decision.ok) return decision;
    this.jobSpentMicro += amountMicro;
    this.dayLedger.add(amountMicro);
    return { ok: true };
  }

  release(amountMicro: bigint): void {
    this.jobSpentMicro -= amountMicro;
    if (this.jobSpentMicro < 0n) this.jobSpentMicro = 0n;
    this.dayLedger.subtract(amountMicro);
  }
}

export type SettlementStatus =
  | "success"
  | "pending"
  | "timeout"
  | "unknown"
  | "free"
  | "dry_run";

export interface HireReceipt {
  endpoint: string;
  payee: string | null;
  amountUsdt0: string;
  amountAtomic: string;
  txHash: string | null;
  settlementStatus: SettlementStatus;
  paidAt: string;
  durationMs: number;
  dryRun: boolean;
}

export interface HireOutcome {
  result: unknown;
  receipt: HireReceipt;
}

export interface HireRequest {
  endpoint: string;
  /** Quoted price from the registry, plain decimal USDT0 string. */
  priceUsdt0: string;
  body?: unknown;
  method?: "POST" | "GET";
  query?: Record<string, string>;
  serviceName?: string;
}

export interface PaymentLayer {
  /**
   * Sign the selected accepts entry and return replay headers.
   * paymentRequired.accepts is pre-filtered to exactly one validated entry.
   */
  createPaymentHeaders(
    paymentRequired: PaymentRequired,
  ): Promise<Record<string, string>>;
}

/** Verdict from the caller's hiring standard on a challenge payee address. */
export interface PayeeVerdict {
  allowed: boolean;
  note?: string;
}

export interface HirerDeps {
  fetchImpl: typeof fetch;
  paymentLayer: PaymentLayer;
  timeoutMs: number;
  now: () => Date;
  /**
   * Gate on the address that will actually receive funds, read from the parsed
   * 402 challenge. Called after the challenge is validated and before anything
   * is reserved or signed, so a rejection costs nothing. The registry payee is
   * only a hint; this is the binding check.
   */
  verifyPayee?: (payee: string) => Promise<PayeeVerdict>;
}

function getTimeoutMs(env: Record<string, string | undefined>): number {
  const raw = env.FOREMAN_SUBCALL_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_SUBCALL_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SUBCALL_TIMEOUT_MS;
}

/** Registry endpoints must be public https URLs; refuse anything else. */
export function assertSafeEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new HirerError(`Invalid endpoint URL: ${endpoint}`, "Config");
  }
  if (url.protocol !== "https:") {
    throw new HirerError(`Endpoint must use https: ${endpoint}`, "Config");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^\[?::1\]?$/.test(host)
  ) {
    throw new HirerError(`Endpoint resolves to a private host: ${endpoint}`, "Config");
  }
  return url;
}

interface AttemptResult {
  response: Response;
}

async function fetchOnce(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** One retry on transient failure: network error, abort, or 5xx. */
async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<AttemptResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= 1; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    }
    try {
      const response = await fetchOnce(fetchImpl, url, init, timeoutMs);
      if (response.status >= 500 && attempt === 0) {
        lastError = new HirerError(
          `Upstream ${response.status} from ${url}`,
          "ServiceFailed",
          response.status,
        );
        continue;
      }
      return { response };
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError instanceof HirerError) throw lastError;
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new HirerError(
    `Request to ${url} failed after retry: ${detail}`,
    "ServiceFailed",
  );
}

/**
 * Extract the x402 PaymentRequired challenge from a 402 response.
 * Prefers the v2 PAYMENT-REQUIRED header; falls back to a v1-style JSON body.
 */
export async function extractPaymentRequired(
  response: Response,
  endpoint: string,
): Promise<PaymentRequired> {
  const header = response.headers.get("PAYMENT-REQUIRED");
  if (header) {
    try {
      const decoded: unknown = JSON.parse(
        Buffer.from(header, "base64").toString("utf8"),
      );
      return decoded as PaymentRequired;
    } catch {
      throw new HirerError(
        `Malformed PAYMENT-REQUIRED header from ${endpoint}`,
        "PaymentFailed",
        402,
      );
    }
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new HirerError(
      `402 from ${endpoint} carried no PAYMENT-REQUIRED header and no JSON body`,
      "PaymentFailed",
      402,
    );
  }
  if (
    typeof body === "object" &&
    body !== null &&
    "x402Version" in body &&
    Array.isArray((body as { accepts?: unknown }).accepts)
  ) {
    const v1 = body as { x402Version: number; accepts: unknown[] };
    return {
      x402Version: v1.x402Version,
      resource: { url: endpoint },
      accepts: v1.accepts as PaymentRequirements[],
    };
  }
  throw new HirerError(
    `402 from ${endpoint} is not an x402 challenge`,
    "PaymentFailed",
    402,
  );
}

interface AcceptCandidate {
  entry: PaymentRequirements;
  amountAtomic: bigint;
}

/**
 * Select the cheapest exact/eip155:196/USDT0 accepts entry.
 * Tolerates v1 bodies that use maxAmountRequired or "$0.05" price strings.
 */
export function selectAcceptsEntry(
  paymentRequired: PaymentRequired,
): AcceptCandidate {
  const candidates: AcceptCandidate[] = [];
  for (const raw of paymentRequired.accepts) {
    const entry = raw as PaymentRequirements & {
      maxAmountRequired?: string;
      price?: string;
    };
    if (entry.scheme !== "exact") continue;
    if (entry.network !== X_LAYER_NETWORK) continue;
    const asset = typeof entry.asset === "string" ? entry.asset : "";
    if (asset.toLowerCase() !== USDT0_ADDRESS.toLowerCase()) continue;

    let amountAtomic: bigint | null = null;
    const atomicRaw = entry.amount ?? entry.maxAmountRequired;
    if (typeof atomicRaw === "string" && /^\d+$/.test(atomicRaw)) {
      amountAtomic = BigInt(atomicRaw);
    } else if (typeof entry.price === "string") {
      const parsed = parseUsdtToMicro(entry.price.replace(/^\$/, ""));
      if (parsed !== null) amountAtomic = parsed;
    }
    if (amountAtomic === null || amountAtomic <= 0n) continue;
    candidates.push({ entry, amountAtomic });
  }

  if (candidates.length === 0) {
    throw new HirerError(
      "No compatible payment option (need exact scheme, X Layer, USDT0)",
      "PaymentFailed",
      402,
    );
  }
  candidates.sort((a, b) => (a.amountAtomic < b.amountAtomic ? -1 : 1));
  const cheapest = candidates[0];
  if (!cheapest) {
    throw new HirerError("No compatible payment option", "PaymentFailed", 402);
  }
  return cheapest;
}

function decodeSettlement(response: Response): {
  txHash: string | null;
  status: SettlementStatus;
  payer: string | null;
} {
  const header = response.headers.get("PAYMENT-RESPONSE");
  if (!header) return { txHash: null, status: "unknown", payer: null };
  try {
    const decoded = JSON.parse(
      Buffer.from(header, "base64").toString("utf8"),
    ) as {
      success?: boolean;
      status?: string;
      transaction?: string;
      payer?: string;
    };
    const status: SettlementStatus =
      decoded.status === "pending"
        ? "pending"
        : decoded.status === "timeout"
          ? "timeout"
          : decoded.success || decoded.status === "success"
            ? "success"
            : "unknown";
    return {
      txHash: decoded.transaction ?? null,
      status,
      payer: decoded.payer ?? null,
    };
  } catch {
    return { txHash: null, status: "unknown", payer: null };
  }
}

let defaultPaymentLayerSingleton: PaymentLayer | null = null;

/**
 * Real payment layer: signs EIP-3009 transferWithAuthorization typed data with
 * the float wallet key via the x402 SDK. Built lazily so importing this module
 * never requires the key.
 */
async function getDefaultPaymentLayer(): Promise<PaymentLayer> {
  if (defaultPaymentLayerSingleton) return defaultPaymentLayerSingleton;

  const pk = process.env.FOREMAN_FLOAT_PRIVATE_KEY?.trim();
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new HirerError(
      "FOREMAN_FLOAT_PRIVATE_KEY is missing or malformed. It must be the 0x-prefixed " +
        "private key of Foreman's operational float wallet (never a caller wallet).",
      "Config",
    );
  }

  const [{ x402Client, x402HTTPClient }, { registerExactEvmScheme }, viem, viemAccounts, viemChains] =
    await Promise.all([
      import("@okxweb3/x402-core/client"),
      import("@okxweb3/x402-evm/exact/client"),
      import("viem"),
      import("viem/accounts"),
      import("viem/chains"),
    ]);

  const rpcUrl = process.env.XLAYER_RPC_URL?.trim() || "https://rpc.xlayer.tech";
  const account = viemAccounts.privateKeyToAccount(pk as `0x${string}`);
  const publicClient = viem.createPublicClient({
    chain: viemChains.xLayer,
    transport: viem.http(rpcUrl),
  });

  // Adapter over the SDK's ClientEvmSigner shape. USDT0 pays via EIP-3009
  // typed-data signatures, so no transaction is ever broadcast from here.
  const signer = {
    address: account.address,
    signTypedData: (message: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) =>
      account.signTypedData(
        message as unknown as Parameters<typeof account.signTypedData>[0],
      ),
    readContract: (args: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
    }) =>
      publicClient.readContract(
        args as Parameters<typeof publicClient.readContract>[0],
      ),
  };

  const client = new x402Client();
  registerExactEvmScheme(client, { signer, networks: [X_LAYER_NETWORK] });
  const httpClient = new x402HTTPClient(client);

  defaultPaymentLayerSingleton = {
    async createPaymentHeaders(paymentRequired) {
      const payload = await httpClient.createPaymentPayload(paymentRequired);
      return httpClient.encodePaymentSignatureHeader(payload);
    },
  };
  return defaultPaymentLayerSingleton;
}

export function buildRequestUrl(req: HireRequest): string {
  const url = assertSafeEndpoint(req.endpoint);
  if (req.query) {
    for (const [k, v] of Object.entries(req.query)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

export function buildRequestInit(
  req: HireRequest,
  extraHeaders?: Record<string, string>,
): RequestInit {
  const method = req.method ?? "POST";
  const headers: Record<string, string> = {
    accept: "application/json",
    ...extraHeaders,
  };
  const init: RequestInit = { method, headers };
  if (method === "POST" && req.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(req.body);
  }
  return init;
}

async function parseResultBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * Mocked outcome for FOREMAN_DRY_RUN and the free playground: no network call,
 * no signature, no spend. The receipt is marked dry_run so it can never be
 * mistaken for a settlement.
 */
export function dryRunHireOutcome(
  req: HireRequest,
  now: () => Date = () => new Date(),
): HireOutcome {
  const quotedMicro = parseUsdtToMicro(req.priceUsdt0) ?? 0n;
  return {
    result: {
      dryRun: true,
      note: `Dry run: ${req.serviceName ?? req.endpoint} was not called and nothing was paid`,
    },
    receipt: {
      endpoint: req.endpoint,
      payee: null,
      amountUsdt0: microToUsdt(quotedMicro),
      amountAtomic: quotedMicro.toString(),
      txHash: null,
      settlementStatus: "dry_run",
      paidAt: now().toISOString(),
      durationMs: 0,
      dryRun: true,
    },
  };
}

/**
 * Perform a paid call to an external ASP endpoint.
 *
 * Spend caps are enforced twice: on the quoted registry price before any
 * request, and on the actual challenge amount before signing. Any breach
 * aborts with a typed SpendLimit / PriceMismatch error; never silently exceed.
 */
export async function payAndCall(
  req: HireRequest,
  spend: SpendController,
  deps?: Partial<HirerDeps>,
): Promise<HireOutcome> {
  const env = process.env;
  const now = deps?.now ?? (() => new Date());
  const started = now().getTime();

  const quotedMicro = parseUsdtToMicro(req.priceUsdt0);
  if (quotedMicro === null) {
    throw new HirerError(
      `Registry price for ${req.endpoint} is not a valid USDT0 amount: "${req.priceUsdt0}"`,
      "Config",
    );
  }

  if (isDryRun(env)) {
    return dryRunHireOutcome(req, now);
  }

  const url = buildRequestUrl(req);
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const timeoutMs = deps?.timeoutMs ?? getTimeoutMs(env);

  // Gate on the quoted price before any network traffic.
  const preCheck = spend.check(quotedMicro);
  if (!preCheck.ok) {
    throw new HirerError(preCheck.message, "SpendLimit");
  }

  const probe = await fetchWithRetry(
    fetchImpl,
    url,
    buildRequestInit(req),
    timeoutMs,
  );

  if (probe.response.status !== 402) {
    if (!probe.response.ok) {
      throw new HirerError(
        `${req.endpoint} returned ${probe.response.status} before payment`,
        "ServiceFailed",
        probe.response.status,
      );
    }
    // Free response: no payment was demanded, nothing spent.
    const result = await parseResultBody(probe.response);
    return {
      result,
      receipt: {
        endpoint: req.endpoint,
        payee: null,
        amountUsdt0: "0",
        amountAtomic: "0",
        txHash: null,
        settlementStatus: "free",
        paidAt: now().toISOString(),
        durationMs: now().getTime() - started,
        dryRun: false,
      },
    };
  }

  const paymentRequired = await extractPaymentRequired(probe.response, req.endpoint);
  const selected = selectAcceptsEntry(paymentRequired);

  // The challenge may demand more than the registry quoted. Never pay it.
  if (selected.amountAtomic > quotedMicro) {
    throw new HirerError(
      `${req.endpoint} demanded ${microToUsdt(selected.amountAtomic)} USDT0 but the ` +
        `registry quotes ${microToUsdt(quotedMicro)}; refusing to pay above quote`,
      "PriceMismatch",
      402,
    );
  }

  // Hiring standard on the real recipient. Runs before any reservation or
  // signature, so a blocked payee never costs float.
  if (deps?.verifyPayee) {
    const verdict = await deps.verifyPayee(selected.entry.payTo);
    if (!verdict.allowed) {
      throw new HirerError(
        `${req.endpoint} pays ${selected.entry.payTo}, which failed the hiring ` +
          `standard${verdict.note ? `: ${verdict.note}` : ""}`,
        "PayeeBlocked",
        402,
      );
    }
  }

  const reservation = spend.reserve(selected.amountAtomic);
  if (!reservation.ok) {
    throw new HirerError(reservation.message, "SpendLimit");
  }

  let paymentHeaders: Record<string, string>;
  try {
    const paymentLayer = deps?.paymentLayer ?? (await getDefaultPaymentLayer());
    paymentHeaders = await paymentLayer.createPaymentHeaders({
      ...paymentRequired,
      accepts: [selected.entry],
    });
  } catch (err) {
    // Nothing was sent; release the reservation.
    spend.release(selected.amountAtomic);
    if (err instanceof HirerError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new HirerError(
      `Payment signing failed for ${req.endpoint}: ${detail}`,
      "PaymentFailed",
    );
  }

  // From here the payment header leaves the process; the reservation stands
  // regardless of outcome because settlement may have occurred server-side.
  const paid = await fetchWithRetry(
    fetchImpl,
    url,
    buildRequestInit(req, paymentHeaders),
    timeoutMs,
  );

  if (paid.response.status === 402) {
    throw new HirerError(
      `${req.endpoint} rejected the signed payment (402 after PAYMENT-SIGNATURE)`,
      "PaymentFailed",
      402,
    );
  }
  if (!paid.response.ok) {
    throw new HirerError(
      `${req.endpoint} returned ${paid.response.status} after payment was sent`,
      "ServiceFailed",
      paid.response.status,
    );
  }

  const settlement = decodeSettlement(paid.response);
  const result = await parseResultBody(paid.response);

  return {
    result,
    receipt: {
      endpoint: req.endpoint,
      payee: selected.entry.payTo,
      amountUsdt0: microToUsdt(selected.amountAtomic),
      amountAtomic: selected.amountAtomic.toString(),
      txHash: settlement.txHash,
      settlementStatus: settlement.status,
      paidAt: now().toISOString(),
      durationMs: now().getTime() - started,
      dryRun: false,
    },
  };
}
