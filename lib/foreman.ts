/**
 * Foreman dispatch engine: one goal and one budget in, subcontracted ASP hires
 * out, receipts for everything.
 *
 * The v1 planner is deterministic: a task taxonomy maps goal patterns to job
 * plans. No LLM and no live marketplace lookup at request time; routing uses
 * the curated registry in config/subcontractors.json with in-house scan
 * fallbacks so a flaky marketplace never breaks a job.
 *
 * Custody line: the inbound dispatch fee is revenue; downstream hires are paid
 * by lib/hirer.ts from Foreman's own operational float. Caller funds are never
 * held or moved by any code path in this module.
 */

import registryJson from "../config/subcontractors.json";
import {
  DaySpendLedger,
  dryRunHireOutcome,
  getGlobalDayLedger,
  getSpendLimits,
  HirerError,
  isDryRun,
  microToUsdt,
  parseUsdtToMicro,
  payAndCall as realPayAndCall,
  SpendController,
  type HireOutcome,
  type HireRequest,
  type HirerDeps,
  type PayeeVerdict,
  type SpendLimits,
} from "./hirer";
import {
  runAgentScan as realRunAgentScan,
  runTokenScan as realRunTokenScan,
  ScanServiceError,
} from "./scan-service";
import {
  SERVICE_NAME,
  SERVICE_VERSION,
  type AgentScanResponse,
  type DisplayGrade,
  type TokenScanResponse,
} from "./types";

export const DISPATCH_PRICE_USDT0 = "0.50";

/** Grades that fail Foreman's hiring standard. */
export const BLOCKED_GRADES: ReadonlySet<string> = new Set(["D", "F"]);

const MAX_GOAL_LENGTH = 2000;

export type TaskKind =
  | "counterparty_diligence"
  | "token_risk"
  | "prediction_market"
  | "security_check";

export interface DispatchContext {
  addresses?: string[];
  tokenAddress?: string;
  agentAddress?: string;
  contractAddress?: string;
  marketId?: string;
  chain?: string;
}

export interface DispatchInput {
  goal: string;
  budget?: number;
  context?: DispatchContext;
}

export interface Subcontractor {
  id: string;
  agentId: string;
  agentName: string;
  serviceName: string;
  capability: TaskKind;
  endpoint: string;
  method: "POST" | "GET";
  requestStyle: "goal-context" | "query-address-chain";
  supportedChains?: string[];
  priceUsdt0: string;
  payeeAddress: string;
  notes?: string;
}

export interface TrustCheckResult {
  status: "passed" | "blocked" | "unavailable";
  grade?: DisplayGrade;
  deliveryProbability?: number;
  /**
   * The address this verdict was actually computed against. Once a 402 has been
   * parsed this is the challenge payTo, which is the address that receives the
   * funds; before that it is the registry hint.
   */
  payee?: string;
  note?: string;
}

export type SubtaskRoute = "external" | "in_house" | "unroutable";

export interface PlannedSubtask {
  kind: TaskKind;
  title: string;
  route: SubtaskRoute;
  provider: string;
  subcontractorId?: string;
  priceUsdt0: string;
  targetAddress?: string;
  rationale: string;
}

export interface DispatchPlan {
  budgetUsdt0: string;
  subtasks: PlannedSubtask[];
  notes: string[];
}

export interface DispatchReceipt {
  subcontractor: string;
  endpoint: string;
  amountUsdt0: string;
  txHash: string | null;
  settlementStatus: string;
  trustCheck: TrustCheckResult | null;
  durationMs: number;
  dryRun: boolean;
}

export interface SubtaskResult {
  kind: TaskKind;
  title: string;
  provider: string;
  status: "ok" | "failed" | "skipped";
  summary: string;
  data?: unknown;
}

export interface DispatchResponse {
  service: typeof SERVICE_NAME;
  scan: "dispatch";
  goal: string;
  plan: DispatchPlan;
  results: SubtaskResult[];
  receipts: DispatchReceipt[];
  totalPaid: string;
  margin: string;
  dryRun: boolean;
  explanation: string;
  scannedAt: string;
  version: typeof SERVICE_VERSION;
}

export type ForemanErrorCode =
  | "BAD_REQUEST"
  | "UNRESOLVABLE"
  | "SPEND_LIMIT"
  | "INTERNAL";

export class ForemanError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ForemanErrorCode,
    readonly details?: string[],
  ) {
    super(message);
    this.name = "ForemanError";
  }
}

/** What Foreman can currently take on; returned verbatim with every 422. */
export const CAPABILITIES: readonly string[] = [
  "Counterparty due diligence: trust-scan an agent or wallet address on X Layer. Provide the 0x address in the goal or context.",
  "Token risk check: safety-scan a token contract. Provide the token address; X Layer is scanned in house, other chains are routed to a marketplace ASP when you name the chain.",
  "Prediction market odds or analysis: hires a marketplace odds ASP. Name the market or question in the goal.",
  "Security or audit style checks: hires a marketplace security ASP, with the in-house trust scan as fallback. Provide the contract address.",
];

const ADDRESS_RE = /0x[0-9a-fA-F]{40}/g;

interface TaxonomyEntry {
  kind: TaskKind;
  title: string;
  pattern: RegExp;
  requiresAddress: boolean;
}

/**
 * Launch taxonomy. Order is the deterministic claim order for addresses found
 * in the goal text when the context does not name them explicitly.
 */
const TAXONOMY: readonly TaxonomyEntry[] = [
  {
    kind: "token_risk",
    title: "Token risk check",
    pattern:
      /\bhoneypot\b|\brug\s?pull\b|\b(token|coin)\b.*\b(risk|risky|safety|safe|scan|scam|check)\b|\b(risk|safety|scan|check)\b.*\b(token|coin)\b/is,
    requiresAddress: true,
  },
  {
    kind: "counterparty_diligence",
    title: "Counterparty due diligence",
    pattern:
      /due\s?diligence|counterpart|reputation|trustworth|trust\s?(scan|score|check)|background\s?check|\bvet\b|\bverify\b.*\b(agent|wallet|address)\b/is,
    requiresAddress: true,
  },
  {
    kind: "prediction_market",
    title: "Prediction market analysis",
    pattern:
      /prediction\s?market|polymarket|kalshi|\bodds\b|probabilit|forecast|market\s?brief/i,
    requiresAddress: false,
  },
  {
    kind: "security_check",
    title: "Security check",
    pattern:
      /security\s?(check|audit|review|scan)|\baudit\b|vulnerab|exploit|certik|skynet/i,
    requiresAddress: true,
  },
];

/** Validate and narrow the raw registry JSON; drop malformed entries loudly. */
export function loadRegistry(
  raw: unknown = registryJson,
): Subcontractor[] {
  const out: Subcontractor[] = [];
  const list =
    typeof raw === "object" && raw !== null && "subcontractors" in raw
      ? (raw as { subcontractors: unknown }).subcontractors
      : null;
  if (!Array.isArray(list)) return out;

  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    const kinds: TaskKind[] = [
      "counterparty_diligence",
      "token_risk",
      "prediction_market",
      "security_check",
    ];
    if (
      typeof e.id !== "string" ||
      typeof e.agentName !== "string" ||
      typeof e.serviceName !== "string" ||
      typeof e.endpoint !== "string" ||
      !e.endpoint.startsWith("https://") ||
      typeof e.priceUsdt0 !== "string" ||
      parseUsdtToMicro(e.priceUsdt0) === null ||
      typeof e.payeeAddress !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(e.payeeAddress) ||
      !kinds.includes(e.capability as TaskKind) ||
      (e.method !== "POST" && e.method !== "GET") ||
      (e.requestStyle !== "goal-context" &&
        e.requestStyle !== "query-address-chain")
    ) {
      console.error(
        "[foreman] dropping malformed registry entry:",
        typeof e.id === "string" ? e.id : "<no id>",
      );
      continue;
    }
    out.push({
      id: e.id,
      agentId: typeof e.agentId === "string" ? e.agentId : "",
      agentName: e.agentName,
      serviceName: e.serviceName,
      capability: e.capability as TaskKind,
      endpoint: e.endpoint,
      method: e.method,
      requestStyle: e.requestStyle,
      supportedChains: Array.isArray(e.supportedChains)
        ? e.supportedChains.filter((c): c is string => typeof c === "string")
        : undefined,
      priceUsdt0: e.priceUsdt0,
      payeeAddress: e.payeeAddress,
      notes: typeof e.notes === "string" ? e.notes : undefined,
    });
  }
  return out;
}

export interface ForemanDeps {
  limits: SpendLimits;
  dayLedger: DaySpendLedger;
  payAndCall: (
    req: HireRequest,
    spend: SpendController,
    hirerDeps?: Partial<HirerDeps>,
  ) => Promise<HireOutcome>;
  runAgentScan: (address: `0x${string}`) => Promise<AgentScanResponse>;
  runTokenScan: (address: `0x${string}`) => Promise<TokenScanResponse>;
  registry: Subcontractor[];
  dryRun: boolean;
  now: () => Date;
}

/**
 * Overrides that force outbound dry run regardless of env. The free playground
 * uses this so preview jobs can never spend real float.
 */
export function forcedDryRunDeps(): Partial<ForemanDeps> {
  return {
    dryRun: true,
    payAndCall: async (req) => dryRunHireOutcome(req),
  };
}

function defaultDeps(): ForemanDeps {
  return {
    limits: getSpendLimits(),
    dayLedger: getGlobalDayLedger(),
    payAndCall: (req, spend, hirerDeps) =>
      realPayAndCall(req, spend, hirerDeps),
    runAgentScan: realRunAgentScan,
    runTokenScan: realRunTokenScan,
    registry: loadRegistry(),
    dryRun: isDryRun(),
    now: () => new Date(),
  };
}

function validateInput(input: DispatchInput): void {
  if (typeof input.goal !== "string" || input.goal.trim() === "") {
    throw new ForemanError(
      'Missing "goal". Provide a natural language goal string.',
      400,
      "BAD_REQUEST",
    );
  }
  if (input.goal.length > MAX_GOAL_LENGTH) {
    throw new ForemanError(
      `Goal too long (max ${MAX_GOAL_LENGTH} characters).`,
      400,
      "BAD_REQUEST",
    );
  }
  if (input.budget !== undefined) {
    if (
      typeof input.budget !== "number" ||
      !Number.isFinite(input.budget) ||
      input.budget <= 0
    ) {
      throw new ForemanError(
        '"budget" must be a positive number of USDT0.',
        400,
        "BAD_REQUEST",
      );
    }
  }
}

function budgetToMicro(budget: number | undefined): bigint | undefined {
  if (budget === undefined) return undefined;
  const micro = parseUsdtToMicro(budget.toFixed(6));
  return micro === null || micro <= 0n ? undefined : micro;
}

function contextAddressFor(
  kind: TaskKind,
  context: DispatchContext,
): string | undefined {
  if (kind === "token_risk") return context.tokenAddress;
  if (kind === "counterparty_diligence") {
    return context.agentAddress ?? context.addresses?.[0];
  }
  if (kind === "security_check") return context.contractAddress;
  return undefined;
}

/**
 * Build the deterministic job plan for a goal. Pure: no network, no spend.
 * Exported for exhaustive planner tests.
 */
export function buildPlan(
  goal: string,
  context: DispatchContext,
  limits: SpendLimits,
  jobCapMicro: bigint,
  registry: Subcontractor[],
): DispatchPlan {
  const matched = TAXONOMY.filter((t) => t.pattern.test(goal));
  if (matched.length === 0) {
    throw new ForemanError(
      "Foreman cannot map this goal to any capability it currently offers.",
      422,
      "UNRESOLVABLE",
      [...CAPABILITIES],
    );
  }

  const goalAddresses = [...new Set(goal.match(ADDRESS_RE) ?? [])];
  const contextPool = [...(context.addresses ?? [])].filter((a) =>
    /^0x[0-9a-fA-F]{40}$/.test(a),
  );
  const pool = [...goalAddresses, ...contextPool];
  const claimed = new Set<string>();
  const notes: string[] = [];
  const subtasks: PlannedSubtask[] = [];
  let plannedSpendMicro = 0n;

  for (const entry of matched) {
    let target = contextAddressFor(entry.kind, context);
    if (target && !/^0x[0-9a-fA-F]{40}$/.test(target)) target = undefined;
    if (!target && entry.requiresAddress) {
      target = pool.find((a) => !claimed.has(a));
    }
    if (target) claimed.add(target);

    if (entry.requiresAddress && !target) {
      subtasks.push({
        kind: entry.kind,
        title: entry.title,
        route: "unroutable",
        provider: "none",
        priceUsdt0: "0",
        rationale: `No 0x address found for this subtask. Provide it in the goal text or in context (${
          entry.kind === "token_risk"
            ? "tokenAddress"
            : entry.kind === "security_check"
              ? "contractAddress"
              : "agentAddress or addresses"
        }).`,
      });
      continue;
    }

    // Taxonomy: counterparty diligence is Foreman's own trade and always runs
    // in house; every other kind prefers a live external subcontractor when a
    // suitable one fits the caps (that is the point of the product).
    const candidates = registry
      .filter(
        (s) =>
          s.capability === entry.kind &&
          entry.kind !== "counterparty_diligence",
      )
      .map((s) => ({ s, micro: parseUsdtToMicro(s.priceUsdt0) }))
      .filter((c): c is { s: Subcontractor; micro: bigint } => c.micro !== null)
      .sort((a, b) => (a.micro < b.micro ? -1 : 1));

    let chosen: { s: Subcontractor; micro: bigint } | undefined;
    for (const c of candidates) {
      if (c.micro > limits.perSubcallMicro) {
        notes.push(
          `${c.s.agentName} (${c.s.serviceName}) skipped: price ${c.s.priceUsdt0} USDT0 exceeds the per-subcall cap ${microToUsdt(limits.perSubcallMicro)}.`,
        );
        continue;
      }
      if (plannedSpendMicro + c.micro > jobCapMicro) {
        notes.push(
          `${c.s.agentName} (${c.s.serviceName}) skipped: would exceed the job budget ${microToUsdt(jobCapMicro)} USDT0.`,
        );
        continue;
      }
      if (
        c.s.requestStyle === "query-address-chain" &&
        (!context.chain ||
          !(c.s.supportedChains ?? []).includes(context.chain.toLowerCase()))
      ) {
        notes.push(
          `${c.s.agentName} (${c.s.serviceName}) skipped: it covers ${(c.s.supportedChains ?? []).join(", ")} and the request ${context.chain ? `names "${context.chain}"` : "names no chain"}.`,
        );
        continue;
      }
      chosen = c;
      break;
    }

    if (chosen) {
      plannedSpendMicro += chosen.micro;
      subtasks.push({
        kind: entry.kind,
        title: entry.title,
        route: "external",
        provider: `${chosen.s.agentName} (${chosen.s.serviceName})`,
        subcontractorId: chosen.s.id,
        priceUsdt0: chosen.s.priceUsdt0,
        targetAddress: target,
        rationale: `Marketplace ASP #${chosen.s.agentId} selected at ${chosen.s.priceUsdt0} USDT0 per call, within all spend caps.`,
      });
      continue;
    }

    // In-house fallback keeps the job alive when no external ASP fits.
    if (entry.kind === "counterparty_diligence" || entry.kind === "security_check") {
      subtasks.push({
        kind: entry.kind,
        title: entry.title,
        route: "in_house",
        provider: "Agent Trust Scan (in-house)",
        priceUsdt0: "0",
        targetAddress: target,
        rationale:
          entry.kind === "security_check"
            ? "No external security ASP fits the caps; falling back to the in-house trust scan on the contract address."
            : "Routed to the in-house Agent Trust Scan.",
      });
    } else if (entry.kind === "token_risk") {
      subtasks.push({
        kind: entry.kind,
        title: entry.title,
        route: "in_house",
        provider: "Token Safety Scan (in-house)",
        priceUsdt0: "0",
        targetAddress: target,
        rationale: "Routed to the in-house Token Safety Scan on X Layer.",
      });
    } else {
      subtasks.push({
        kind: entry.kind,
        title: entry.title,
        route: "unroutable",
        provider: "none",
        priceUsdt0: "0",
        rationale:
          "No prediction market ASP fits the current spend caps and there is no in-house fallback yet.",
      });
    }
  }

  if (subtasks.every((s) => s.route === "unroutable")) {
    throw new ForemanError(
      "Foreman matched this goal but cannot execute any part of it: " +
        subtasks.map((s) => s.rationale).join(" "),
      422,
      "UNRESOLVABLE",
      [...CAPABILITIES],
    );
  }

  return {
    budgetUsdt0: microToUsdt(jobCapMicro),
    subtasks,
    notes,
  };
}

/**
 * Shape the outbound request for one subcontractor. Exported so liveness
 * probes can send exactly what a real hire would send.
 */
export function buildHireRequest(
  sub: Subcontractor,
  goal: string,
  context: DispatchContext,
  target: string | undefined,
): HireRequest {
  if (sub.requestStyle === "query-address-chain") {
    return {
      endpoint: sub.endpoint,
      priceUsdt0: sub.priceUsdt0,
      method: "GET",
      query: {
        address: target ?? "",
        chain: (context.chain ?? "").toLowerCase(),
      },
      serviceName: `${sub.agentName} ${sub.serviceName}`,
    };
  }
  return {
    endpoint: sub.endpoint,
    priceUsdt0: sub.priceUsdt0,
    method: sub.method,
    body: {
      goal,
      context: {
        address: target,
        marketId: context.marketId,
        chain: context.chain,
      },
    },
    serviceName: `${sub.agentName} ${sub.serviceName}`,
  };
}

/** Pull a short human summary out of an unknown external response. */
function summarizeExternalData(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  for (const key of ["summary", "verdict", "direction", "result", "message", "note"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      const text = value.trim();
      return text.length > 200 ? `${text.slice(0, 197)}...` : text;
    }
  }
  return null;
}

interface SubtaskExecution {
  result: SubtaskResult;
  receipt: DispatchReceipt | null;
  planNotes: string[];
}

async function runInHouse(
  planned: PlannedSubtask,
  deps: ForemanDeps,
): Promise<SubtaskResult> {
  const address = planned.targetAddress as `0x${string}`;
  try {
    if (planned.kind === "token_risk") {
      const scan = await deps.runTokenScan(address);
      return {
        kind: planned.kind,
        title: planned.title,
        provider: planned.provider,
        status: "ok",
        summary: `Token ${address} scores ${scan.score} with risk level ${scan.riskLevel}${scan.flags.length > 0 ? ` (${scan.flags.length} flag${scan.flags.length === 1 ? "" : "s"})` : ""}.`,
        data: scan,
      };
    }
    const scan = await deps.runAgentScan(address);
    return {
      kind: planned.kind,
      title: planned.title,
      provider: planned.provider,
      status: "ok",
      summary: `Address ${address} grades ${scan.grade} with delivery probability ${scan.deliveryProbability} (confidence ${scan.confidence}).`,
      data: scan,
    };
  } catch (err) {
    const detail =
      err instanceof ScanServiceError
        ? `${err.message}${err.details ? `: ${err.details}` : ""}`
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      kind: planned.kind,
      title: planned.title,
      provider: planned.provider,
      status: "failed",
      summary: `In-house scan failed: ${detail}`,
    };
  }
}

/**
 * Subtasks run concurrently, so the cache holds the in-flight promise rather
 * than the settled value. Caching the value alone lets two subtasks sharing a
 * payee both miss and scan the same address twice.
 */
function trustCheckPayee(
  payee: string,
  deps: ForemanDeps,
  cache: Map<string, Promise<TrustCheckResult>>,
): Promise<TrustCheckResult> {
  const key = payee.toLowerCase();
  const inFlight = cache.get(key);
  if (inFlight) return inFlight;
  const started = computeTrustCheck(payee, deps);
  cache.set(key, started);
  return started;
}

async function computeTrustCheck(
  payee: string,
  deps: ForemanDeps,
): Promise<TrustCheckResult> {
  let check: TrustCheckResult;
  if (deps.dryRun) {
    check = {
      status: "passed",
      note: "Dry run: hiring standard not executed against live chain data.",
    };
  } else {
    try {
      const scan = await deps.runAgentScan(payee as `0x${string}`);
      check = BLOCKED_GRADES.has(scan.grade)
        ? {
            status: "blocked",
            grade: scan.grade,
            deliveryProbability: scan.deliveryProbability,
            note: `Hiring standard: grade ${scan.grade} is in the blocked band.`,
          }
        : {
            status: "passed",
            grade: scan.grade,
            deliveryProbability: scan.deliveryProbability,
            note:
              scan.grade === "UNRATED"
                ? "Hiring standard: payee has too little history to rate; hired with caution."
                : undefined,
          };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      check = {
        status: "unavailable",
        note: `Hiring standard could not run (${detail}); hired without verification.`,
      };
    }
  }
  return check;
}

async function runExternal(
  planned: PlannedSubtask,
  goal: string,
  context: DispatchContext,
  spend: SpendController,
  deps: ForemanDeps,
  trustCache: Map<string, Promise<TrustCheckResult>>,
): Promise<SubtaskExecution> {
  const sub = deps.registry.find((s) => s.id === planned.subcontractorId);
  if (!sub) {
    return {
      result: {
        kind: planned.kind,
        title: planned.title,
        provider: planned.provider,
        status: "failed",
        summary: "Planned subcontractor missing from the registry.",
      },
      receipt: null,
      planNotes: [],
    };
  }

  // Hiring standard: trust-scan the payee before the first payment in a job.
  const trust = await trustCheckPayee(sub.payeeAddress, deps, trustCache);
  if (trust.status === "blocked") {
    const note = `${sub.agentName} not hired: ${trust.note ?? "blocked by the hiring standard"}`;
    const fallback = fallbackPlanFor(planned);
    if (fallback) {
      const result = await runInHouse(fallback, deps);
      return { result, receipt: null, planNotes: [note] };
    }
    return {
      result: {
        kind: planned.kind,
        title: planned.title,
        provider: planned.provider,
        status: "failed",
        summary: note,
      },
      receipt: null,
      planNotes: [note],
    };
  }

  // The registry payee above is only a hint. The binding check runs against the
  // payTo in the parsed 402, before anything is reserved or signed.
  const captured: { trust: TrustCheckResult | null; note: string | null } = {
    trust: null,
    note: null,
  };
  const verifyPayee = async (payee: string): Promise<PayeeVerdict> => {
    const check = await trustCheckPayee(payee, deps, trustCache);
    const mismatched =
      payee.toLowerCase() !== sub.payeeAddress.toLowerCase();
    const mismatchNote = mismatched
      ? `Payee mismatch: the challenge pays ${payee} but the registry lists ${sub.payeeAddress}.`
      : null;
    captured.note = mismatchNote;
    captured.trust = {
      ...check,
      payee,
      note: [check.note, mismatchNote].filter(Boolean).join(" ") || undefined,
    };
    return {
      allowed: check.status !== "blocked",
      note: captured.trust.note,
    };
  };

  const started = deps.now().getTime();
  try {
    const outcome = await deps.payAndCall(
      buildHireRequest(sub, goal, context, planned.targetAddress),
      spend,
      { verifyPayee },
    );
    const receipt: DispatchReceipt = {
      subcontractor: `${sub.agentName} (${sub.serviceName})`,
      endpoint: sub.endpoint,
      amountUsdt0: outcome.receipt.amountUsdt0,
      txHash: outcome.receipt.txHash,
      settlementStatus: outcome.receipt.settlementStatus,
      trustCheck: captured.trust ?? trust,
      durationMs: outcome.receipt.dryRun
        ? 0
        : deps.now().getTime() - started,
      dryRun: outcome.receipt.dryRun,
    };
    const externalSummary = summarizeExternalData(outcome.result);
    return {
      result: {
        kind: planned.kind,
        title: planned.title,
        provider: planned.provider,
        status: "ok",
        summary: outcome.receipt.dryRun
          ? `Dry run: would hire ${sub.agentName} (${sub.serviceName}) for ${sub.priceUsdt0} USDT0.`
          : `Hired ${sub.agentName} (${sub.serviceName}) for ${outcome.receipt.amountUsdt0} USDT0${externalSummary ? `: ${externalSummary}` : "; response attached."}`,
        data: outcome.result,
      },
      receipt,
      planNotes: captured.note ? [`${sub.agentName}: ${captured.note}`] : [],
    };
  } catch (err) {
    if (err instanceof HirerError && err.kind === "SpendLimit") {
      // A runtime cap breach aborts the whole job cleanly; planning should
      // have prevented it, so surfacing it loudly is the safe behavior.
      throw new ForemanError(
        `Job aborted by spend controls: ${err.message}`,
        409,
        "SPEND_LIMIT",
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    // A payee rejected at the challenge reads as a hiring decision, not a fault.
    const note =
      err instanceof HirerError && err.kind === "PayeeBlocked"
        ? `${sub.agentName} not hired: ${detail}`
        : `${sub.agentName} hire failed (${err instanceof HirerError ? err.kind : "Error"}): ${detail}`;
    const fallback = fallbackPlanFor(planned);
    if (fallback) {
      const result = await runInHouse(fallback, deps);
      return { result, receipt: null, planNotes: [note] };
    }
    return {
      result: {
        kind: planned.kind,
        title: planned.title,
        provider: planned.provider,
        status: "failed",
        summary: note,
      },
      receipt: null,
      planNotes: [note],
    };
  }
}

/** In-house fallback plan for a failed or blocked external subtask. */
function fallbackPlanFor(planned: PlannedSubtask): PlannedSubtask | null {
  if (!planned.targetAddress) return null;
  if (planned.kind === "token_risk") {
    return {
      ...planned,
      route: "in_house",
      provider: "Token Safety Scan (in-house fallback)",
      priceUsdt0: "0",
    };
  }
  if (planned.kind === "counterparty_diligence" || planned.kind === "security_check") {
    return {
      ...planned,
      route: "in_house",
      provider: "Agent Trust Scan (in-house fallback)",
      priceUsdt0: "0",
    };
  }
  return null;
}

function buildExplanation(
  results: SubtaskResult[],
  receipts: DispatchReceipt[],
  totalPaid: string,
  notes: string[],
  dryRun: boolean,
): string {
  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const parts: string[] = [
    `Foreman decomposed the goal into ${results.length} subtask${results.length === 1 ? "" : "s"}: ${ok} completed, ${failed} failed, ${skipped} skipped.`,
  ];
  if (receipts.length > 0) {
    parts.push(
      dryRun
        ? `Dry run: ${receipts.length} marketplace hire${receipts.length === 1 ? "" : "s"} simulated for ${totalPaid} USDT0; nothing was paid.`
        : `${receipts.length} marketplace hire${receipts.length === 1 ? "" : "s"} paid onchain, ${totalPaid} USDT0 total, receipts attached.`,
    );
  } else {
    parts.push("No marketplace hires were needed; everything ran in house.");
  }
  if (notes.length > 0) {
    parts.push(`Plan notes: ${notes.join(" ")}`);
  }
  return parts.join(" ");
}

/**
 * Run a full dispatch job. Throws ForemanError for 4xx refusals; every other
 * failure is contained inside per-subtask results so partial value survives.
 */
export async function runDispatch(
  input: DispatchInput,
  overrides?: Partial<ForemanDeps>,
): Promise<DispatchResponse> {
  const deps: ForemanDeps = { ...defaultDeps(), ...overrides };
  validateInput(input);

  const goal = input.goal.trim();
  const context = input.context ?? {};
  const budgetMicro = budgetToMicro(input.budget);
  const spend = new SpendController(deps.limits, deps.dayLedger, budgetMicro);

  const plan = buildPlan(goal, context, deps.limits, spend.jobCapMicro, deps.registry);

  const trustCache = new Map<string, Promise<TrustCheckResult>>();
  const receipts: DispatchReceipt[] = [];
  const runtimeNotes: string[] = [];

  const executions = await Promise.all(
    plan.subtasks.map(async (planned): Promise<SubtaskResult> => {
      if (planned.route === "unroutable") {
        return {
          kind: planned.kind,
          title: planned.title,
          provider: "none",
          status: "skipped",
          summary: planned.rationale,
        };
      }
      if (planned.route === "in_house") {
        return runInHouse(planned, deps);
      }
      const execution = await runExternal(
        planned,
        goal,
        context,
        spend,
        deps,
        trustCache,
      );
      if (execution.receipt) receipts.push(execution.receipt);
      runtimeNotes.push(...execution.planNotes);
      return execution.result;
    }),
  );

  const totalPaidMicro = receipts.reduce((sum, r) => {
    const micro = parseUsdtToMicro(r.amountUsdt0);
    return micro === null ? sum : sum + micro;
  }, 0n);
  const feeMicro = parseUsdtToMicro(DISPATCH_PRICE_USDT0) ?? 0n;
  const marginMicro = feeMicro - totalPaidMicro;
  const totalPaid = microToUsdt(totalPaidMicro);
  const allNotes = [...plan.notes, ...runtimeNotes];

  return {
    service: SERVICE_NAME,
    scan: "dispatch",
    goal,
    plan: { ...plan, notes: allNotes },
    results: executions,
    receipts,
    totalPaid,
    margin: microToUsdt(marginMicro < 0n ? 0n : marginMicro),
    dryRun: deps.dryRun,
    explanation: buildExplanation(
      executions,
      receipts,
      totalPaid,
      allNotes,
      deps.dryRun,
    ),
    scannedAt: deps.now().toISOString(),
    version: SERVICE_VERSION,
  };
}
