# Agent DNA Runbook

Builder: Ludarep. Deploy and listing steps are manual (no git commit/push from automation).

## Local development

1. Node 20+.
2. Copy env:

```bash
copy .env.example .env.local
```

3. Set at minimum for local UI + free playground:

```
OKXOS_API_KEY=your_key
OKXOS_SECRET_KEY=your_secret
OKXOS_PASSPHRASE=your_passphrase
DEMO_MODE=true
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Keys come from the OKX OS developer portal at web3.okx.com/build/dev-portal: Connect Wallet, verify with a signature, link email and phone, create a project, then create an API key with a passphrase. The secret key is shown under View details. Legacy `OKLINK_*` names in an existing `.env.local` keep working as fallbacks.

4. Install and run:

```bash
npm install
npm run dev
```

5. Checks:

```bash
npm test
npm run typecheck
```

6. Smoke:

- `GET http://localhost:3000/api/health` (shows `demoMode`)
- Playground on `/` calls `POST /api/playground/scan` (free, same-origin, 10/hour)
- With `DEMO_MODE=true`, paid routes also run without payment proof

7. Chain data smoke (live OKX OS call with your credentials):

```bash
npx tsx scripts/smoke-chaindata.ts
npx tsx scripts/smoke-chaindata.ts 0xSomeAddress 0xSomeToken
```

Defaults to the USDT0 contract on X Layer for both address and token. Prints the normalized address summary, recent transactions, token info, top holders, and recent trades, then `SMOKE OK`. If your local resolver blocks okx.com domains (some ISPs do), run it behind a VPN or DNS override; Vercel is unaffected.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `OKXOS_API_KEY` | Yes for live data | OKX OS Web3 API key (dev portal project) |
| `OKXOS_SECRET_KEY` | Yes for live data | HMAC secret for OK-ACCESS-SIGN |
| `OKXOS_PASSPHRASE` | Yes for live data | API key passphrase |
| `OKLINK_*` | Legacy alias | Old names for the three vars above; still read as fallbacks |
| `DEMO_MODE` | Local only | `true` bypasses x402 on `/api/scan/*`. Production paid ASP: `false` or unset |
| `OKX_API_KEY` | Production paid | OKX SA API key (x402 facilitator) |
| `OKX_SECRET_KEY` | Production paid | HMAC secret |
| `OKX_PASSPHRASE` | Production paid | SA passphrase |
| `X402_PAYTO_ADDRESS` | Production paid | Seller wallet on X Layer (receives USDT0). Prefer this name |
| `PAY_TO` | Alias | Accepted if `X402_PAYTO_ADDRESS` is empty (SELLER.md name) |
| `OKX_FACILITATOR_BASE_URL` | Optional | Default `https://web3.okx.com` |
| `NEXT_PUBLIC_SITE_URL` | Recommended | Canonical URL / OG / llms.txt |

`.env.local` is gitignored. Never commit secrets.

## Routes

| Path | Payment | Notes |
| --- | --- | --- |
| `POST /api/scan/agent` | x402 `$0.05` when DEMO_MODE off | Public paid Agent Scan |
| `POST /api/scan/token` | x402 `$0.01` when DEMO_MODE off | Public paid Token Scan |
| `POST /api/playground/scan` | Free | Same-origin + 10/hour/IP. Response includes `playground: true` |
| `GET /api/health` | Free | Version + demoMode |

## Vercel env setup (production paid ASP)

1. Import `rudazy/AgentDNA` in Vercel.
2. Framework: Next.js (vercel.json present). Next 16.
3. Production environment variables:

```
OKXOS_API_KEY=...
OKXOS_SECRET_KEY=...
OKXOS_PASSPHRASE=...
DEMO_MODE=false
OKX_API_KEY=...
OKX_SECRET_KEY=...
OKX_PASSPHRASE=...
X402_PAYTO_ADDRESS=0xYourSellerWallet
NEXT_PUBLIC_SITE_URL=https://agentdnas.vercel.app
```

Optional: `OKX_FACILITATOR_BASE_URL` only if OKX gives a non-default facilitator host.

4. Deploy. Confirm:

- Site loads; playground still works (free route)
- `/llms.txt` is public
- `/api/health` returns `demoMode: false`
- Unpaid `POST /api/scan/agent` returns **402** with `accepts` / payment challenge
- Paid curl examples on the page still point at `/api/scan/*`, not playground

## Manual smoke: one real paid call

Prereqs: production deploy with DEMO_MODE=false, valid OKX SA keys, `X402_PAYTO_ADDRESS` set, and an x402-capable client (OKX Agentic Wallet / Onchain OS buyer).

1. Unpaid probe (expect 402):

```bash
curl -i -X POST https://agentdnas.vercel.app/api/scan/agent ^
  -H "Content-Type: application/json" ^
  -d "{\"address\":\"0x...\"}"
```

Confirm status 402 and challenge body includes `accepts[0].price` = `$0.05`, `network` = `eip155:196`, `payTo` = your `X402_PAYTO_ADDRESS`.

2. Paid call from an x402 agent/wallet:

- Call the same URL with a signed payment proof header (`PAYMENT-SIGNATURE` or `X-PAYMENT`) for `$0.05` USDT0 on X Layer to `X402_PAYTO_ADDRESS`.
- Expect HTTP 200 JSON DNA payload.
- Successful settlement attaches a `PAYMENT-RESPONSE` header (SDK).

3. Confirm settlement on chain:

- Check the `X402_PAYTO_ADDRESS` wallet on X Layer for a USDT0 credit of 0.05 (agent) or 0.01 (token).
- Explorer: https://web3.okx.com/explorer/x-layer

4. Token route: same flow with `POST /api/scan/token` at `$0.01`.

## Remaining manual steps for Ludarep

1. Create OKX Onchain OS project keys and set `OKXOS_API_KEY`, `OKXOS_SECRET_KEY`, `OKXOS_PASSPHRASE` on Vercel.
2. Get OKX SA seller credentials and set `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, `X402_PAYTO_ADDRESS`.
3. Deploy with `DEMO_MODE=false` for the public paid ASP endpoint.
4. Register + list A2MCP using `docs/listing.md` via Onchain OS.
5. Run the paid smoke test above once.
6. Git commit and push yourself when ready. Automation does not run git write operations.

## QA greps (before ship)

```bash
rg "\u2014" --glob "!node_modules/**" --glob "!.next/**"
rg "[\x{1F300}-\x{1FAFF}]" --glob "!node_modules/**" --glob "!.next/**"
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| 503 chain data | Missing/invalid `OKXOS_API_KEY`, `OKXOS_SECRET_KEY`, or `OKXOS_PASSPHRASE`; or sign mismatch |
| 429 with quota message | OKX OS Basic/Premium monthly free quota (100K calls each) exhausted; top up or subscribe in the dev portal |
| Local ENOTFOUND web3.okx.com | Some resolvers block okx.com domains; use VPN or DNS override. Vercel is unaffected |
| 402 always on paid routes | Expected without payment when DEMO_MODE off; check credentials + `X402_PAYTO_ADDRESS` |
| Playground 403 | Must call from browser same origin (Origin/Referer host match) |
| Playground 429 | 10 free scans per hour per IP (in-memory per isolate) |
| Empty DNA / low confidence | Fresh wallet; valid result |
| Client import errors | Do not import `lib/x402-server.ts` or `lib/payment.ts` from client components; use `lib/constants.ts` |
