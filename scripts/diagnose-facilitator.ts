/**
 * Isolate the x402 facilitator handshake that gates every paid route.
 *
 * The SDK collapses every failure here into one message ("no supported payment
 * kinds loaded from any facilitator"), which cannot distinguish a rejected
 * credential from an account that is simply not provisioned for x402. This
 * script performs the same GET the SDK performs and prints the raw status and
 * body, then checks whether a USDT0 on X Layer kind is actually offered.
 *
 * It reproduces OKXFacilitatorClient exactly:
 *   GET {baseUrl}/api/v6/pay/x402/supported
 *   HMAC-SHA256 over timestamp + "GET" + path, no body
 *   Headers OK-ACCESS-KEY / SIGN / TIMESTAMP / PASSPHRASE
 *
 * Read only. Signs nothing, settles nothing, spends nothing.
 *
 * Usage: npx tsx scripts/diagnose-facilitator.ts
 * Env: OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE, optional OKX_FACILITATOR_BASE_URL
 * VPN must be on: this machine's resolver blocks okx.com domains.
 */

import crypto from "crypto";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { USDT0_ADDRESS, X_LAYER_NETWORK } from "../lib/constants";

const SUPPORTED_PATH = "/api/v6/pay/x402/supported";
const DEFAULT_BASE_URL = "https://web3.okx.com";

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

interface Kind {
  x402Version?: number;
  network?: string;
  scheme?: string;
  asset?: string;
  extra?: Record<string, unknown>;
}

function fingerprint(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

async function main(): Promise<void> {
  loadEnvLocal();

  const apiKey = process.env.OKX_API_KEY?.trim() ?? "";
  const secretKey = process.env.OKX_SECRET_KEY?.trim() ?? "";
  const passphrase = process.env.OKX_PASSPHRASE?.trim() ?? "";
  const configuredBase = process.env.OKX_FACILITATOR_BASE_URL?.trim() ?? "";
  const baseUrl = configuredBase || DEFAULT_BASE_URL;

  console.log("Facilitator config");
  console.log("------------------");
  console.log(`  base URL          ${baseUrl}${configuredBase ? "" : "  (SDK default)"}`);
  console.log(`  full URL          ${baseUrl}${SUPPORTED_PATH}`);
  // Fingerprints only. Enough to tell two key sets apart, never the value.
  console.log(`  OKX_API_KEY       ${apiKey ? `set, len ${apiKey.length}, fp ${fingerprint(apiKey)}` : "MISSING"}`);
  console.log(`  OKX_SECRET_KEY    ${secretKey ? `set, len ${secretKey.length}, fp ${fingerprint(secretKey)}` : "MISSING"}`);
  console.log(`  OKX_PASSPHRASE    ${passphrase ? `set, len ${passphrase.length}` : "MISSING"}`);

  const okxosKey = process.env.OKXOS_API_KEY?.trim() ?? "";
  if (okxosKey && apiKey && fingerprint(okxosKey) === fingerprint(apiKey)) {
    console.log(
      "\n  WARNING: OKX_API_KEY is identical to OKXOS_API_KEY. Those are different\n" +
        "  credential families. OKXOS_* is the dev portal Web3 data API; the x402\n" +
        "  facilitator needs OKX SA keys provisioned for pay/x402. This alone can\n" +
        "  produce a 401 and therefore zero payment kinds.",
    );
  }
  if (configuredBase.endsWith("/")) {
    console.log(
      "\n  WARNING: OKX_FACILITATOR_BASE_URL ends with a slash, which yields a double\n" +
        "  slash in the request path. Remove the trailing slash.",
    );
  }
  if (configuredBase.includes("/facilitator")) {
    console.log(
      "\n  WARNING: OKX_FACILITATOR_BASE_URL contains /facilitator. That is the default\n" +
        "  for the generic HTTPFacilitatorClient, NOT for OKXFacilitatorClient, which\n" +
        "  appends /api/v6/pay/x402/... itself. This produces a 404 and zero kinds.",
    );
  }

  if (!apiKey || !secretKey || !passphrase) {
    console.log("\nCannot call the facilitator without all three credentials.");
    process.exit(1);
  }

  const timestamp = new Date().toISOString();
  const prehash = `${timestamp}GET${SUPPORTED_PATH}`;
  const sign = crypto
    .createHmac("sha256", secretKey)
    .update(prehash)
    .digest("base64");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${SUPPORTED_PATH}`, {
      method: "GET",
      headers: {
        "OK-ACCESS-KEY": apiKey,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": passphrase,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.log("\nRequest failed before a response");
    console.log("-------------------------------");
    console.log(`  ${detail}`);
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(detail)) {
      console.log("  DNS resolution failed. Turn the VPN on and retry.");
    }
    process.exit(1);
  }

  const text = await response.text();
  console.log("\nResponse");
  console.log("--------");
  console.log(`  status ${response.status}`);
  console.log(`  body   ${text.slice(0, 800)}`);

  if (!response.ok) {
    console.log("\nDiagnosis");
    console.log("---------");
    console.log(
      response.status === 401 || response.status === 403
        ? "  Credentials rejected. The SA key is wrong, revoked, IP restricted, or not\n" +
            "  provisioned for x402 settlement. This surfaces as zero payment kinds."
        : response.status === 404
          ? "  Path not found. Almost always a wrong OKX_FACILITATOR_BASE_URL.\n" +
            "  It must be the host only, https://web3.okx.com, with no path suffix."
          : `  Facilitator returned ${response.status}. Zero kinds will be loaded.`,
    );
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.log("\nDiagnosis\n---------\n  200 but body is not JSON.");
    process.exit(1);
  }

  const payload = (parsed as { data?: unknown }).data ?? parsed;
  const kinds = ((payload as { kinds?: Kind[] }).kinds ?? []) as Kind[];

  console.log("\nSupported kinds");
  console.log("---------------");
  if (kinds.length === 0) {
    console.log("  none returned");
    console.log("\nDiagnosis");
    console.log("---------");
    console.log(
      "  The facilitator authenticated the request and returned an empty kinds list.\n" +
        "  Credentials are fine; the account is not provisioned for x402 settlement.\n" +
        "  No code or env change fixes this. It needs enabling on the OKX side.",
    );
    process.exit(1);
  }

  for (const kind of kinds) {
    console.log(
      `  v${kind.x402Version ?? "?"} ${kind.network ?? "?"} ${kind.scheme ?? "?"}${kind.asset ? ` asset=${kind.asset}` : ""}`,
    );
  }

  const match = kinds.find(
    (kind) => kind.network === X_LAYER_NETWORK && kind.scheme === "exact",
  );

  console.log("\nDiagnosis");
  console.log("---------");
  if (!match) {
    console.log(
      `  Kinds were returned but none match ${X_LAYER_NETWORK} with the exact scheme,\n` +
        "  which is what this app registers and quotes. Paid routes cannot settle.",
    );
    process.exit(1);
  }
  console.log(`  Found ${X_LAYER_NETWORK} exact. The facilitator handshake is healthy.`);
  if (match.asset && match.asset.toLowerCase() !== USDT0_ADDRESS.toLowerCase()) {
    console.log(
      `  Note: the kind advertises asset ${match.asset}, which is not the USDT0 address\n` +
        `  this app quotes (${USDT0_ADDRESS}). Confirm which asset settlement expects.`,
    );
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(
      `\nDIAGNOSE_FAIL ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
