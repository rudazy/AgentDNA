/**
 * Liveness probe for the curated subcontractor registry.
 *
 * Runs ONLY the unpaid first leg of the hire flow: send the request a real hire
 * would send, with no payment header, and inspect the 402 challenge that comes
 * back. Nothing is signed and no float is spent, because this module never imports the
 * payment layer, so there is no code path here that can produce a signature.
 *
 * Per registry entry it answers three questions:
 *   1. Does the endpoint respond at all?
 *   2. Is the 402 a parseable x402 challenge with a usable accepts entry?
 *   3. Does the challenge amount match the registry priceUsdt0?
 *
 * Note FOREMAN_DRY_RUN is irrelevant here. payAndCall short-circuits on that
 * flag before any network traffic, so dry run proves nothing about liveness;
 * this probe deliberately bypasses it and talks to the real endpoints.
 *
 * Single attempt per entry, no retry: a probe should report flakiness rather
 * than paper over it.
 *
 * Usage: npx tsx scripts/probe-subcontractors.ts
 * Exit code 1 if any entry is unreachable or would abort a real hire.
 */

import { fileURLToPath } from "url";
import {
  buildHireRequest,
  loadRegistry,
  type DispatchContext,
  type Subcontractor,
} from "../lib/foreman";
import {
  buildRequestInit,
  buildRequestUrl,
  extractPaymentRequired,
  microToUsdt,
  parseUsdtToMicro,
  selectAcceptsEntry,
} from "../lib/hirer";

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Realistic probe inputs. A garbage address makes a healthy service answer 400,
 * which reads as "dead" when it is not, so each capability gets a plausible
 * live target.
 */
const PROBE_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

function probeInputs(sub: Subcontractor): {
  goal: string;
  context: DispatchContext;
  target: string | undefined;
} {
  // PROBE_ADDRESS is an Ethereum mainnet token, so prefer whichever spelling of
  // Ethereum this provider uses before falling back to its first listed chain.
  const supported = sub.supportedChains ?? [];
  const chain =
    supported.find((c) => c === "ethereum" || c === "eth") ??
    supported[0] ??
    "ethereum";
  switch (sub.capability) {
    case "token_risk":
      return {
        goal: `Token risk check for ${PROBE_ADDRESS}`,
        context: { chain, tokenAddress: PROBE_ADDRESS },
        target: PROBE_ADDRESS,
      };
    case "security_check":
      return {
        goal: `Security audit for contract ${PROBE_ADDRESS}`,
        context: { chain, contractAddress: PROBE_ADDRESS },
        target: PROBE_ADDRESS,
      };
    case "prediction_market":
      return {
        goal: "Prediction market brief: BTC direction over the next 24 hours",
        context: { marketId: "btc-24h" },
        target: undefined,
      };
    default:
      return {
        goal: `Counterparty due diligence on ${PROBE_ADDRESS}`,
        context: { chain, agentAddress: PROBE_ADDRESS },
        target: PROBE_ADDRESS,
      };
  }
}

type Verdict = "OK" | "WARN" | "FAIL";

interface ProbeResult {
  id: string;
  agentName: string;
  verdict: Verdict;
  status: string;
  challenge: string;
  quoteMatch: string;
  detail?: string;
  durationMs: number;
}

function timeoutMs(): number {
  const raw = process.env.FOREMAN_SUBCALL_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

async function probeOne(sub: Subcontractor): Promise<ProbeResult> {
  const base: Omit<
    ProbeResult,
    "verdict" | "status" | "challenge" | "quoteMatch" | "durationMs"
  > = { id: sub.id, agentName: sub.agentName };
  const started = Date.now();

  const { goal, context, target } = probeInputs(sub);
  const req = buildHireRequest(sub, goal, context, target);

  const quotedMicro = parseUsdtToMicro(sub.priceUsdt0);
  if (quotedMicro === null) {
    return {
      ...base,
      verdict: "FAIL",
      status: "-",
      challenge: "-",
      quoteMatch: "-",
      detail: `Registry price "${sub.priceUsdt0}" is not a valid USDT0 amount`,
      durationMs: 0,
    };
  }

  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    response = await fetch(buildRequestUrl(req), {
      ...buildRequestInit(req),
      signal: controller.signal,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      verdict: "FAIL",
      status: "no response",
      challenge: "-",
      quoteMatch: "-",
      detail,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - started;
  const status = String(response.status);

  // 2xx: service did not demand payment. payAndCall would treat this as a free
  // call and return the body, so it is live and costs nothing.
  if (response.ok) {
    return {
      ...base,
      verdict: "WARN",
      status,
      challenge: "none demanded",
      quoteMatch: "n/a",
      detail: "Responded without demanding payment; a real hire would be free",
      durationMs,
    };
  }

  if (response.status !== 402) {
    return {
      ...base,
      verdict: "FAIL",
      status,
      challenge: "-",
      quoteMatch: "-",
      detail: "Non-402 error before payment; a real hire would abort here",
      durationMs,
    };
  }

  // 402: parse the challenge exactly as the hirer does, but stop before signing.
  try {
    const paymentRequired = await extractPaymentRequired(response, sub.endpoint);
    const selected = selectAcceptsEntry(paymentRequired);
    const challenge = microToUsdt(selected.amountAtomic);

    if (selected.amountAtomic > quotedMicro) {
      return {
        ...base,
        verdict: "FAIL",
        status,
        challenge,
        quoteMatch: `above quote ${sub.priceUsdt0}`,
        detail: "Hirer would refuse to pay above the registry quote",
        durationMs,
      };
    }
    return {
      ...base,
      verdict: "OK",
      status,
      challenge,
      quoteMatch:
        selected.amountAtomic === quotedMicro
          ? "exact"
          : `under quote ${sub.priceUsdt0}`,
      durationMs,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      verdict: "FAIL",
      status,
      challenge: "unparseable",
      quoteMatch: "-",
      detail,
      durationMs,
    };
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main(): Promise<void> {
  const registry = loadRegistry();
  console.log(
    `Probing ${registry.length} subcontractor${registry.length === 1 ? "" : "s"} (unpaid 402 handshake, zero spend)\n`,
  );

  const results: ProbeResult[] = [];
  for (const sub of registry) {
    const r = await probeOne(sub);
    results.push(r);
    console.log(
      `${pad(r.verdict, 5)} ${pad(r.id, 26)} status=${pad(r.status, 12)} challenge=${pad(r.challenge, 14)} quote=${pad(r.quoteMatch, 20)} ${r.durationMs}ms`,
    );
    if (r.detail) console.log(`      ${r.detail}`);
  }

  const failed = results.filter((r) => r.verdict === "FAIL").length;
  const warned = results.filter((r) => r.verdict === "WARN").length;
  const ok = results.filter((r) => r.verdict === "OK").length;
  console.log(`\n${ok} OK, ${warned} WARN, ${failed} FAIL`);

  if (failed > 0) process.exit(1);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error("PROBE_FAIL", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
