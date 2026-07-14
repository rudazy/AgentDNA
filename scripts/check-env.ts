/**
 * Prints which env vars are set without printing values.
 * Usage: npx tsx scripts/check-env.ts
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const keys = [
  "OKXOS_API_KEY",
  "OKXOS_SECRET_KEY",
  "OKXOS_PASSPHRASE",
  // Legacy aliases still honored by lib/chaindata.ts
  "OKLINK_API_KEY",
  "OKLINK_SECRET_KEY",
  "OKLINK_PASSPHRASE",
  "DEMO_MODE",
  "OKX_API_KEY",
  "OKX_SECRET_KEY",
  "OKX_PASSPHRASE",
  "X402_PAYTO_ADDRESS",
  "PAY_TO",
  "NEXT_PUBLIC_SITE_URL",
];

const path = resolve(process.cwd(), ".env.local");
if (!existsSync(path)) {
  console.log("ENV_LOCAL: missing");
  process.exit(1);
}

const text = readFileSync(path, "utf8");
// also load into process for optional live check
for (const line of text.split(/\r?\n/)) {
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

console.log("ENV_LOCAL: present");
for (const k of keys) {
  const v = (process.env[k] ?? "").trim();
  const set = v.length > 0 && !/^your[_-]?/i.test(v);
  console.log(`${k}: ${set ? `SET(len=${v.length})` : "EMPTY_OR_MISSING"}`);
}
