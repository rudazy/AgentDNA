/**
 * Live smoke: OKX OS Web3 API signed auth + normalized chain data for X Layer.
 * Loads .env.local, never prints secrets.
 *
 * Usage: npx tsx scripts/smoke-chaindata.ts [address] [tokenAddress]
 * Defaults to the USDT0 contract on X Layer for both.
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const DEFAULT_ADDRESS = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) {
    throw new Error(".env.local missing");
  }
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const k = m[1]!;
    let v = m[2] ?? "";
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

function isDnsFailure(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${String(err.cause ?? "")}` : String(err);
  return /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text);
}

async function main(): Promise<void> {
  loadEnvLocal();

  const address = process.argv[2] ?? DEFAULT_ADDRESS;
  const token = process.argv[3] ?? DEFAULT_ADDRESS;

  const {
    getAddressSummary,
    getAddressTransactions,
    getTokenHolders,
    getTokenInfo,
    getTokenTrades,
  } = await import("../lib/chaindata");

  try {
    console.log(`Address summary for ${address}`);
    const summary = await getAddressSummary(address);
    console.log(JSON.stringify(summary, null, 2));

    console.log("Recent transactions (up to 20)");
    const { txs } = await getAddressTransactions(address, { page: 1, limit: 20 });
    console.log(`  count=${txs.length}`);
    for (const tx of txs.slice(0, 3)) {
      console.log(
        `  ${tx.hash.slice(0, 18)}... ${new Date(tx.timestampMs).toISOString()} ${tx.status} value=${tx.value}`,
      );
    }

    console.log(`Token info for ${token}`);
    const info = await getTokenInfo(token);
    console.log(JSON.stringify(info, null, 2));

    console.log("Token holders (top 20)");
    const { holders } = await getTokenHolders(token, { page: 1, limit: 20 });
    console.log(`  count=${holders.length}`);
    for (const h of holders.slice(0, 3)) {
      console.log(`  ${h.address} ${h.percentage.toFixed(4)}%`);
    }

    console.log("Token trades (up to 20)");
    const { trades } = await getTokenTrades(token, { page: 1, limit: 20 });
    console.log(`  count=${trades.length}`);
    for (const t of trades.slice(0, 3)) {
      console.log(
        `  ${t.side} by ${t.trader.slice(0, 12)}... usd=${t.volumeUsd} at ${new Date(t.timestampMs).toISOString()}`,
      );
    }

    console.log("SMOKE OK");
  } catch (err) {
    if (isDnsFailure(err)) {
      console.error(
        "DNS failure resolving web3.okx.com. This machine's resolver blocks okx.com domains; " +
          "use a VPN or a DNS override (hosts entry / DoH) and retry. Production on Vercel is unaffected.",
      );
    }
    throw err;
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    process.exit(1);
  });
}
