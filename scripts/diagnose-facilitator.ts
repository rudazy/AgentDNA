/**
 * Isolate the x402 facilitator handshake that gates every paid route.
 *
 * The SDK collapses every failure here into one message ("no supported payment
 * kinds loaded from any facilitator"), which cannot distinguish a rejected
 * credential from an account that is simply not provisioned for x402. This
 * prints the raw status and the parsed kinds instead.
 *
 * The probe itself lives in lib/facilitator-diag.ts and is shared with the
 * temporary route at /api/diag/facilitator, so local and deployed results are
 * produced by identical code. Read only: signs nothing, spends nothing.
 *
 * Usage: npx tsx scripts/diagnose-facilitator.ts
 * Env: OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE, optional OKX_FACILITATOR_BASE_URL
 * VPN must be on: this machine's resolver blocks okx.com domains.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import {
  diagnoseFacilitator,
  DEFAULT_FACILITATOR_BASE_URL,
  SUPPORTED_PATH,
} from "../lib/facilitator-diag";

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

function section(title: string): void {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

async function main(): Promise<void> {
  loadEnvLocal();
  const result = await diagnoseFacilitator();

  section("Facilitator config");
  console.log(
    `  base URL   ${result.baseUrl}${result.baseUrlConfigured ? "" : "  (SDK default)"}`,
  );
  console.log(`  full URL   ${result.baseUrl}${SUPPORTED_PATH}`);
  if (result.baseUrlWarning) {
    console.log(`\n  WARNING: ${result.baseUrlWarning}`);
    console.log(`  Expected: ${DEFAULT_FACILITATOR_BASE_URL}`);
  }

  section("Credentials");
  const c = result.credentials;
  console.log(
    `  OKX_API_KEY      ${c.apiKeySet ? `set, fp ${c.apiKeyFingerprint}` : "MISSING"}`,
  );
  console.log(`  OKX_SECRET_KEY   ${c.secretKeySet ? "set" : "MISSING"}`);
  console.log(`  OKX_PASSPHRASE   ${c.passphraseSet ? "set" : "MISSING"}`);
  console.log(
    `  OKXOS_API_KEY    ${c.okxosApiKeyFingerprint ? `set, fp ${c.okxosApiKeyFingerprint}` : "not set"}`,
  );
  if (c.sameKeyAsOkxosDataApi) {
    console.log(
      "\n  WARNING: OKX_API_KEY is identical to OKXOS_API_KEY. Those are different\n" +
        "  credential families. OKXOS_* is the dev portal Web3 data API; the x402\n" +
        "  facilitator needs OKX SA keys provisioned for pay/x402.",
    );
  }

  section("Response");
  console.log(`  status            ${result.status ?? "no response"}`);
  console.log(`  kinds returned    ${result.kindCount}`);
  console.log(`  eip155:196 exact  ${result.hasXLayerExactKind}`);
  for (const kind of result.kinds) {
    console.log(
      `    v${kind.x402Version ?? "?"} ${kind.network ?? "?"} ${kind.scheme ?? "?"}${kind.asset ? ` asset=${kind.asset}` : ""}`,
    );
  }
  if (result.errorBody) console.log(`  error body        ${result.errorBody}`);

  section("Diagnosis");
  console.log(`  ${result.diagnosis}`);

  if (!result.ok) process.exit(1);
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
