/**
 * One real paid dispatch against the live Foreman endpoint, from a buyer wallet.
 *
 * This script is the BUYER side of x402. It mirrors what any calling agent does:
 * send the dispatch request unpaid, receive the 402 challenge, sign an EIP-3009
 * USDT0 authorization on X Layer, retry with the payment header, and print the
 * settled result. Foreman's own outbound hires are a separate concern paid from
 * its float wallet; nothing here touches that key.
 *
 * Safety rails:
 *   - Refuses to pay a challenge above MAX_PAY_USDT0 (0.50).
 *   - Without --confirm it stops immediately before signing. Everything up to
 *     that point is free, so a rehearsal proves the flow without spending.
 *   - One dispatch per invocation, no loops, no retries after payment.
 *
 * Usage:
 *   npx tsx scripts/paid-dispatch.ts                 (rehearsal, no payment)
 *   npx tsx scripts/paid-dispatch.ts --confirm       (real payment, 0.50 USDT0)
 *
 * Options: --goal "<text>", --budget <usdt0>, --url <endpoint>
 * Env: BUYER_PRIVATE_KEY (required for --confirm), DISPATCH_URL, XLAYER_RPC_URL
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { USDT0_ADDRESS, X_LAYER_NETWORK } from "../lib/constants";
import type { DispatchResponse } from "../lib/foreman";
import {
  extractPaymentRequired,
  microToUsdt,
  parseUsdtToMicro,
  selectAcceptsEntry,
} from "../lib/hirer";

const DEFAULT_URL = "https://agentdnas.vercel.app/api/dispatch";

/** Hard ceiling for this script. The endpoint quotes 0.50; never pay above it. */
const MAX_PAY_USDT0 = "0.50";

/**
 * Routes to two external hires: ChainSentry on the token, CertiK on the
 * contract. Both targets are named on bsc because chain resolution is job-wide,
 * and the token clause comes first because addresses are claimed in taxonomy
 * order (token_risk before security_check), not in sentence order. Changing
 * either of those without checking the plan will silently swap the targets.
 */
const DEFAULT_GOAL =
  "Check token safety for 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82 on bsc " +
  "and run a CertiK security audit on 0x55d398326f99059fF775485246999027B3197955 on bsc";

const DEFAULT_BUDGET = 0.35;

/** Optional .env.local load. Shell env always wins so CI can pass values in. */
function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

interface Options {
  confirm: boolean;
  goal: string;
  budget: number;
  url: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    confirm: false,
    goal: process.env.DISPATCH_GOAL?.trim() || DEFAULT_GOAL,
    budget: Number(process.env.DISPATCH_BUDGET ?? DEFAULT_BUDGET),
    url: process.env.DISPATCH_URL?.trim() || DEFAULT_URL,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--confirm") opts.confirm = true;
    else if (arg === "--goal") opts.goal = argv[++i] ?? opts.goal;
    else if (arg === "--budget") opts.budget = Number(argv[++i] ?? opts.budget);
    else if (arg === "--url") opts.url = argv[++i] ?? opts.url;
  }
  if (!Number.isFinite(opts.budget) || opts.budget <= 0) {
    throw new Error("--budget must be a positive number of USDT0");
  }
  return opts;
}

/** Settlement details the seller attaches after a successful payment. */
function decodePaymentResponse(response: Response): {
  txHash: string | null;
  status: string;
  payer: string | null;
} {
  const header = response.headers.get("PAYMENT-RESPONSE");
  if (!header) return { txHash: null, status: "no settlement header", payer: null };
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      success?: boolean;
      status?: string;
      transaction?: string;
      payer?: string;
    };
    return {
      txHash: decoded.transaction ?? null,
      status: decoded.status ?? (decoded.success ? "success" : "unknown"),
      payer: decoded.payer ?? null,
    };
  } catch {
    return { txHash: null, status: "unparseable settlement header", payer: null };
  }
}

/**
 * Buyer-side x402 signer. Built only when --confirm is passed, so a rehearsal
 * never needs the key present.
 */
async function buildBuyerSigner(): Promise<{
  address: string;
  createPaymentHeaders: (pr: unknown) => Promise<Record<string, string>>;
}> {
  const pk = process.env.BUYER_PRIVATE_KEY?.trim();
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error(
      "BUYER_PRIVATE_KEY is missing or malformed. It must be the 0x-prefixed " +
        "private key of the buyer wallet, set in .env.local or the shell.",
    );
  }

  const [
    { x402Client, x402HTTPClient },
    { registerExactEvmScheme },
    viem,
    viemAccounts,
    viemChains,
  ] = await Promise.all([
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

  // USDT0 settles via EIP-3009 typed-data signatures; nothing is broadcast here.
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

  return {
    address: account.address,
    async createPaymentHeaders(paymentRequired: unknown) {
      const payload = await httpClient.createPaymentPayload(
        paymentRequired as Parameters<typeof httpClient.createPaymentPayload>[0],
      );
      return httpClient.encodePaymentSignatureHeader(payload);
    },
  };
}

function section(title: string): void {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function printDispatch(body: DispatchResponse): void {
  section("Plan");
  console.log(`Budget cap: ${body.plan.budgetUsdt0} USDT0`);
  for (const task of body.plan.subtasks) {
    const chain = task.providerChain ? ` chain=${task.providerChain}` : "";
    console.log(
      `  ${pad(task.kind, 24)} route=${pad(task.route, 10)} ${task.provider}${chain}`,
    );
  }
  if (body.plan.notes.length > 0) {
    console.log("Notes:");
    for (const note of body.plan.notes) console.log(`  ${note}`);
  }

  section("Results");
  for (const result of body.results) {
    console.log(`  [${result.status.toUpperCase()}] ${result.title}`);
    console.log(`    ${result.summary}`);
  }

  section("Receipts (downstream hires)");
  if (body.receipts.length === 0) {
    console.log("  none, everything ran in house");
  } else {
    for (const receipt of body.receipts) {
      console.log(`  ${receipt.subcontractor}`);
      console.log(`    amount     ${receipt.amountUsdt0} USDT0`);
      console.log(`    tx         ${receipt.txHash ?? "none"}`);
      console.log(`    settlement ${receipt.settlementStatus}`);
      console.log(
        `    trust      ${receipt.trustCheck?.status ?? "not run"}` +
          `${receipt.trustCheck?.grade ? ` grade ${receipt.trustCheck.grade}` : ""}` +
          `${receipt.trustCheck?.payee ? ` payee ${receipt.trustCheck.payee}` : ""}`,
      );
      if (receipt.trustCheck?.note) {
        console.log(`    note       ${receipt.trustCheck.note}`);
      }
    }
  }

  section("Totals");
  console.log(`  Paid downstream  ${body.totalPaid} USDT0`);
  console.log(`  Foreman margin   ${body.margin} USDT0`);
  console.log(`  Dry run          ${body.dryRun}`);
}

async function main(): Promise<void> {
  loadEnvLocal();
  const opts = parseArgs(process.argv.slice(2));

  section("Request");
  console.log(`  Endpoint ${opts.url}`);
  console.log(`  Budget   ${opts.budget} USDT0`);
  console.log(`  Mode     ${opts.confirm ? "REAL PAYMENT" : "rehearsal, no payment"}`);
  console.log(`  Goal     ${opts.goal}`);

  const body = JSON.stringify({ goal: opts.goal, budget: opts.budget });
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body,
  };

  const probe = await fetch(opts.url, init);

  if (probe.status !== 402) {
    // Either the gate is off (DEMO_MODE) or something is wrong. Either way there
    // is nothing to pay, so report and stop.
    const text = await probe.text();
    section("Unexpected: endpoint did not demand payment");
    console.log(`  status ${probe.status}`);
    console.log(`  body   ${text.slice(0, 600)}`);
    process.exit(probe.ok ? 0 : 1);
  }

  const paymentRequired = await extractPaymentRequired(probe, opts.url);
  const selected = selectAcceptsEntry(paymentRequired);
  const capMicro = parseUsdtToMicro(MAX_PAY_USDT0)!;

  section("Payment challenge");
  console.log(`  Amount   ${microToUsdt(selected.amountAtomic)} USDT0`);
  console.log(`  Network  ${selected.entry.network}`);
  console.log(`  Asset    ${selected.entry.asset}`);
  console.log(`  Pay to   ${selected.entry.payTo}`);

  if (selected.amountAtomic > capMicro) {
    section("Aborted");
    console.log(
      `  Challenge demands ${microToUsdt(selected.amountAtomic)} USDT0 which is above ` +
        `the ${MAX_PAY_USDT0} ceiling in this script. Nothing was signed.`,
    );
    process.exit(1);
  }
  if (selected.entry.network !== X_LAYER_NETWORK) {
    section("Aborted");
    console.log(
      `  Challenge is on ${selected.entry.network}, expected ${X_LAYER_NETWORK}. Nothing was signed.`,
    );
    process.exit(1);
  }
  if (
    typeof selected.entry.asset === "string" &&
    selected.entry.asset.toLowerCase() !== USDT0_ADDRESS.toLowerCase()
  ) {
    section("Aborted");
    console.log(
      `  Challenge asset ${selected.entry.asset} is not USDT0. Nothing was signed.`,
    );
    process.exit(1);
  }

  if (!opts.confirm) {
    section("Stopped before signing");
    console.log("  dry run, pass --confirm to send real payment");
    console.log(
      `  A real run would pay ${microToUsdt(selected.amountAtomic)} USDT0 to ${selected.entry.payTo}.`,
    );
    return;
  }

  const buyer = await buildBuyerSigner();
  section("Signing");
  console.log(`  Buyer wallet ${buyer.address}`);
  console.log(`  Paying       ${microToUsdt(selected.amountAtomic)} USDT0`);

  const headers = await buyer.createPaymentHeaders({
    ...paymentRequired,
    accepts: [selected.entry],
  });

  const paid = await fetch(opts.url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...headers },
  });

  const settlement = decodePaymentResponse(paid);

  section("Inbound payment to Foreman");
  console.log(`  Amount      ${microToUsdt(selected.amountAtomic)} USDT0`);
  console.log(`  Settlement  ${settlement.status}`);
  console.log(`  Tx hash     ${settlement.txHash ?? "none returned"}`);
  console.log(`  Payer       ${settlement.payer ?? buyer.address}`);

  if (!paid.ok) {
    const text = await paid.text();
    section("Dispatch failed after payment");
    console.log(`  status ${paid.status}`);
    console.log(`  body   ${text.slice(0, 800)}`);
    process.exit(1);
  }

  printDispatch((await paid.json()) as DispatchResponse);

  section("Verify on chain");
  console.log("  Explorer: https://web3.okx.com/explorer/x-layer");
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`\nPAID_DISPATCH_FAIL ${detail}`);
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(detail)) {
      console.error(
        "Looks like DNS resolution failed. Turn the VPN on: this machine's resolver " +
          "blocks the okx.com rails and can block the deployment host.",
      );
    }
    process.exit(1);
  });
}
