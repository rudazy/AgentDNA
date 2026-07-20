# Foreman Runbook (repo: AgentDNA)

Builder: Ludarep. Deploy and listing steps are manual (no git commit/push from automation).

Product: Foreman, the employer of the agent economy. One paid dispatch call in (`POST /api/dispatch`, 0.50 USDT0), subcontracted marketplace hires out, receipts for everything. The two original scans remain standalone paid services and gate every hire. Internal module and repo names intentionally keep the Agent DNA naming; the brand change is user-facing only.

Custody line: Foreman NEVER holds or moves caller funds. The inbound x402 fee is revenue to `X402_PAYTO_ADDRESS`. Downstream hires are paid from Foreman's OWN operational float wallet (`FOREMAN_FLOAT_PRIVATE_KEY`), which signs nothing except its own outgoing service payments.

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
| `FOREMAN_FLOAT_PRIVATE_KEY` | Production dispatch | 0x private key of Foreman's operational float wallet. Pays downstream hires in USDT0 on X Layer. Never a caller wallet |
| `FOREMAN_DRY_RUN` | Local / preview | `true` mocks all OUTBOUND hires (no payment, no network). Independent of DEMO_MODE |
| `MAX_SPEND_PER_SUBCALL` | Optional | Cap per downstream call in USDT0. Default `0.10` |
| `MAX_SPEND_PER_JOB` | Optional | Cap per dispatch job in USDT0. Default `0.35` |
| `MAX_SPEND_PER_DAY` | Optional | Cap per UTC day in USDT0 (in-memory per isolate). Default `5.00` |
| `FOREMAN_SUBCALL_TIMEOUT_MS` | Optional | Timeout per downstream call. Default `20000` |
| `XLAYER_RPC_URL` | Optional | X Layer RPC for the buyer signer. Default `https://rpc.xlayer.tech` |
| `BUYER_PRIVATE_KEY` | Script only | Buyer wallet key used by `scripts/paid-dispatch.ts --confirm`. A caller wallet, never Foreman's float. Not read by the app |
| `DISPATCH_URL` | Script only | Endpoint for `scripts/paid-dispatch.ts`. Default `https://agentdnas.vercel.app/api/dispatch` |

`.env.local` is gitignored. Never commit secrets.

## Routes

| Path | Payment | Notes |
| --- | --- | --- |
| `POST /api/dispatch` | x402 `$0.50` when DEMO_MODE off | Foreman Dispatch: goal + budget in, results + receipts out. At most MAX_SPEND_PER_JOB (0.35) paid downstream |
| `POST /api/scan/agent` | x402 `$0.05` when DEMO_MODE off | Public paid Agent Scan (also Foreman's hiring standard) |
| `POST /api/scan/token` | x402 `$0.01` when DEMO_MODE off | Public paid Token Scan |
| `POST /api/playground/scan` | Free | Same-origin + 10/hour/IP. Response includes `playground: true`. Dispatch previews are FORCED dry run server-side and can never spend float |
| `GET /api/health` | Free | Version + demoMode |

## Foreman mode flags (DEMO_MODE vs FOREMAN_DRY_RUN)

Two independent switches; know which side of the money each controls:

- `DEMO_MODE=true` bypasses the INBOUND payment gate only (callers are not charged the 0.50 fee). Outbound hiring still uses real payments from the float wallet unless dry run is also set.
- `FOREMAN_DRY_RUN=true` mocks the OUTBOUND hires only: no downstream network calls, no signatures, no spend; receipts come back marked `dry_run`. The inbound gate is unaffected.
- Local dev: set both. Production: set neither.
- The free playground dispatch preview ignores the env and always runs the outbound side in forced dry run.

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
FOREMAN_FLOAT_PRIVATE_KEY=0x...
```

Optional Foreman overrides: `MAX_SPEND_PER_SUBCALL`, `MAX_SPEND_PER_JOB`, `MAX_SPEND_PER_DAY`, `FOREMAN_SUBCALL_TIMEOUT_MS`, `XLAYER_RPC_URL`. Do NOT set `FOREMAN_DRY_RUN` in production.

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

## Float wallet: funding, sizing, rotation

The float wallet is operational capital owned by Ludarep. It pays hired ASPs; it never touches caller funds.

1. Create a fresh EVM wallet (never reuse the payTo wallet or any personal wallet). Export its private key into `FOREMAN_FLOAT_PRIVATE_KEY` (Vercel env, and `.env.local` for local live tests only).
2. Fund it with USDT0 on X Layer (eip155:196, token `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`). Recommended starting float: 5 USDT0 (one day at MAX_SPEND_PER_DAY). Bridge or withdraw via OKX to X Layer, or swap on X Layer.
3. Gas: USDT0 payments use EIP-3009 signatures settled by the OKX facilitator, so the float wallet does not need OKB for normal operation.
4. Top up when the balance approaches MAX_SPEND_PER_JOB; below that, jobs start failing over to in-house fallbacks (jobs degrade, they do not break).
5. Key rotation: create a new wallet, move the remaining USDT0 balance to it, update `FOREMAN_FLOAT_PRIVATE_KEY` in Vercel, redeploy, then treat the old key as burned. Rotate immediately if the key ever appears in a log, error, or commit.

## Onchain OS: Foreman rebrand and service registration (chat steps)

Prereqs: VPN on (local resolver blocks okx.com), NEW Claude Code session, avatar file present at `docs/assets/foreman-avatar-440.png`, production deploy live so the endpoint answers 402.

1. `Log in to Agentic Wallet on Onchain OS with my email` (use the wallet email on file; do not commit personal addresses).
2. `Show my agents on OKX.AI` and confirm #6018 is yours and its current review status.
3. Update the identity: `Update my agent #6018 on OKX.AI: change the name, description, and avatar`. Use the exact values from docs/listing.md section "Foreman rebrand and registration answers" (name `Foreman`, the one-sentence description, avatar file path above).
4. IMPORTANT FALLBACK: if the skill reports that renaming an onchain identity is not supported, keep the identity name `Agent DNA`, apply only the description and avatar update, and present `Foreman Dispatch` as the flagship service. Record which path was taken in tasks/todo.md.
5. Add the service: `Add a service to my agent #6018` with service name `Foreman Dispatch`, type A2MCP, fee `0.50`, endpoint `https://agentdnas.vercel.app/api/dispatch`, and the two-part description from docs/listing.md. Do not touch the two existing scan services.
6. Resubmit for review / re-list if prompted: `Help me list my ASP on OKX.AI using Onchain OS`. Review results go to the Agentic Wallet email.
7. Review every confirmation card before replying; screenshot anything unexpected.

## Subcontractor registry refresh (manual, local)

`config/subcontractors.json` is the curated list of hireable ASPs. The onchainos CLI is not available on Vercel, so refresh locally:

```bash
onchainos agent search --query "prediction market odds" --status active
onchainos agent search --query "security audit" --status active
onchainos agent service-list --agent-id <id>
```

Only A2MCP services with a public https endpoint are hireable. Copy `endpoint`, `feeAmount` (as `priceUsdt0`), and the agent's `communicationAddress` (as `payeeAddress`). Keep prices at or under `MAX_SPEND_PER_SUBCALL` or the planner will skip the entry.

## Manual smoke: one real dispatch

After the paid scan smoke below, with `FOREMAN_FLOAT_PRIVATE_KEY` set and the float funded:

1. Unpaid probe (expect 402 with `accepts[0].price` = `$0.50`):

```bash
curl -i -X POST https://agentdnas.vercel.app/api/dispatch ^
  -H "Content-Type: application/json" ^
  -d "{\"goal\":\"polymarket odds on the fed cutting rates\",\"budget\":0.05}"
```

2. Paid call from an x402 client. Expect 200 with `plan`, `results`, `receipts[]`; each external receipt carries `txHash`, `settlementStatus`, and `trustCheck`.
3. Verify the receipt tx hashes on the X Layer explorer and confirm the float wallet balance dropped by exactly `totalPaid`.

## Recorded paid dispatch (scripts/paid-dispatch.ts)

One clean buyer-side run against the live endpoint, for demo recording. The
script is the x402 BUYER: it pays Foreman's inbound 0.50 USDT0 fee the same way
any calling agent would, then prints the plan, results, receipts, and settlement
transaction hashes.

VPN must be on. This machine's resolver blocks okx.com domains, and the okx.com
payment rails plus the deployment host are both reached during a real run.

Env needed in `.env.local`:

```
BUYER_PRIVATE_KEY=0x...
DISPATCH_URL=https://agentdnas.vercel.app/api/dispatch
XLAYER_RPC_URL=
```

`BUYER_PRIVATE_KEY` is a caller wallet funded with USDT0 on X Layer. It is not
Foreman's float and no route in the app reads it.

1. Rehearsal. Does everything except sign and pay, then stops:

```bash
npx tsx scripts/paid-dispatch.ts
```

Expect the request block, the payment challenge (0.50 USDT0, `eip155:196`, the
seller payTo), then `dry run, pass --confirm to send real payment`. Nothing is
spent.

2. Real recorded call:

```bash
npx tsx scripts/paid-dispatch.ts --confirm
```

Expect the inbound settlement tx hash, the plan with each subtask route and
provider, the results, the per subcontractor receipts with their own tx hashes
and trust verdicts, then totals.

Options: `--goal "<text>"`, `--budget <usdt0>`, `--url <endpoint>`.

Safety rails: refuses any challenge above 0.50 USDT0, refuses a challenge that
is not USDT0 on `eip155:196`, and runs exactly one dispatch with no loops.

Default goal note: chain resolution is job-wide and addresses are claimed in
taxonomy order (token risk before security check), not sentence order. The
default goal names both targets on bsc and puts the token clause first for that
reason. If you change it, run the rehearsal first and confirm the plan block
pairs each address with the intended subtask.

## Facilitator diagnostic (CLI only)

`scripts/diagnose-facilitator.ts` runs the same signed, read-only `getSupported`
call the SDK makes, and prints the raw status and parsed kinds. Use it when a
paid route reports "no supported payment kinds". Read only: signs nothing,
settles nothing, spends nothing. No secret value is printed; credentials appear
only as a SHA-256 prefix.

```bash
npx tsx scripts/diagnose-facilitator.ts
```

VPN must be on, since this machine's resolver blocks okx.com domains.

Interpretation: 401 or 403 means the SA key is wrong, revoked, IP restricted, or
not provisioned for x402; 404 means a wrong `OKX_FACILITATOR_BASE_URL`, which
should normally be unset; 200 with an empty kinds list means the credentials are
fine but the account is not provisioned for x402 settlement.

There was previously a token-gated web route at `/api/diag/facilitator` for
running this against the deployed environment. It was removed after the
facilitator issue was resolved. If it is ever needed again, rebuild it gated
behind an env token so that deploying the file alone exposes nothing.

## Remaining manual steps for Ludarep

1. Place the avatar file at `docs/assets/foreman-avatar-440.png`.
2. Create the float wallet, fund it with 5 USDT0 on X Layer, set `FOREMAN_FLOAT_PRIVATE_KEY` on Vercel (see Float wallet section).
3. Confirm existing Vercel env (`OKXOS_*`, `OKX_*`, `X402_PAYTO_ADDRESS`, `DEMO_MODE=false`) and deploy.
4. Rebrand identity #6018 and register `Foreman Dispatch` via the Onchain OS chat steps above; resubmit for review.
5. Run the paid scan smoke and the dispatch smoke once each.
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
| 503 stage `request`, "no supported payment kinds" | The facilitator returned zero kinds. Run `npx tsx scripts/diagnose-facilitator.ts` (VPN on) for the raw status and body. A cause in the `details` chain means the call failed with that HTTP status; no cause means it returned 200 with an empty kinds list, which is an account not provisioned for x402 rather than a config fault |
| 503 `X402_WIRING_FAILED` on a paid route | The seller wiring failed. Read `stage` in the body: `credentials` means OKX SA vars or `X402_PAYTO_ADDRESS` are missing; `facilitator` means `OKXFacilitatorClient` construction threw; `route-config` means the route config threw; `middleware` means `withX402` threw at import; `request` means the deferred facilitator sync failed on first request, usually invalid, expired, or revoked OKX SA credentials, or the facilitator host being unreachable from the deploy region |
| Empty 500 with no body on a paid route | Should no longer happen. `protectWithX402` catches wiring throws at import and at request time and returns 503 JSON instead. An empty 500 now means a crash outside that guard; check Vercel function logs |
| 402 always on paid routes | Expected without payment when DEMO_MODE off; check credentials + `X402_PAYTO_ADDRESS` |
| Playground 403 | Must call from browser same origin (Origin/Referer host match) |
| Playground 429 | 10 free scans per hour per IP (in-memory per isolate) |
| Empty DNA / low confidence | Fresh wallet; valid result |
| Client import errors | Do not import `lib/x402-server.ts` or `lib/payment.ts` from client components; use `lib/constants.ts` |
