# Phase 0 Research Notes: Agent DNA

Recorded 2026-07-13. Sources fetched live where DNS allowed; some OKX doc hosts (`web3.okx.com`) failed DNS on this machine, so those pages were recovered via search snippets and the official GitHub SDK docs.

---

## 1. Payment verification (per call)

**Model:** HTTP 402 / x402. Paid A2MCP endpoints must speak x402. Free endpoints return results with no billing.

**Flow (seller side):**

1. Client hits a priced route without a payment proof.
2. Server responds `402 Payment Required` with payment challenge details (price, network, payee, scheme).
3. Client (Agentic Wallet / Onchain OS) signs payment authorization (EIP-3009 for USDT0, or Permit2 for other ERC-20s).
4. Client retries with payment proof headers:
   - `PAYMENT-SIGNATURE` or `X-PAYMENT` (x402 family)
   - or `Authorization: Payment ...` (MPP family)
5. Server verifies via OKX facilitator (SA API, HMAC-SHA256), then settles and returns the resource. Successful responses may carry `PAYMENT-RESPONSE` settlement proof.

**SDK packages (TypeScript):**

| Package | Role |
| --- | --- |
| `@okxweb3/x402-core` | `OKXFacilitatorClient`, `x402ResourceServer` |
| `@okxweb3/x402-evm` | Schemes: `ExactEvmScheme`, `UptoEvmScheme`, `DeferredEvmScheme` |
| `@okxweb3/x402-next` | Next.js: `withX402`, `withX402FromHTTPServer`, `paymentProxyFromHTTPServer` |
| `@okxweb3/x402-express` | Express middleware (reference examples) |

**Docs:**

- Seller SDK (full): https://github.com/okx/payments/blob/master/typescript/SELLER.md
- Overview: https://github.com/okx/payments
- Onchain OS seller page (DNS flaky here): https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk
- ASP tutorial: https://okx.ai/tutorial/asp

**Env vars for payment (from SELLER.md):**

```
OKX_API_KEY=
OKX_SECRET_KEY=
OKX_PASSPHRASE=
PAY_TO=                 # seller wallet on X Layer
```

Optional channel-only vars (not needed for fixed per-call exact scheme): `MPP_SECRET_KEY`, `MPP_MERCHANT_PRIVATE_KEY`, `MPP_ESCROW`.

**Price declaration:**

- x402 family: USD strings (`"$0.05"`), numbers (`0.05`), or `{ asset, amount }` in atomic units.
- MPP family: base units only (`"50000"` for 0.05 of a 6-decimal token). No `"$..."` syntax.

**Agent DNA prices:**

- Agent Scan: `$0.05` (0.05 USDT0 per call)
- Token Scan: `$0.01` (0.01 USDT0 per call)

**DEMO_MODE:** When `DEMO_MODE=true`, payment verification is bypassed for local playground and demo video. When `DEMO_MODE` is off and credentials or verification are unavailable, routes return `402` with a clear error body. Never silent fake verification in production paths.

---

## 1b. x402 live wiring update (2026-07-13 session 2)

Confirmed against SELLER.md and `@okxweb3/x402-next@0.1.1` types:

| Topic | Finding |
| --- | --- |
| Next.js App Router API | `withX402(handler, routeConfig, resourceServer)` or `withX402FromHTTPServer(handler, httpServer)` from `@okxweb3/x402-next` |
| Middleware alternate | `paymentProxy` / `paymentProxyFromHTTPServer` for `middleware.ts` matcher |
| Network | `eip155:196` only |
| Asset | USDT0 `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` (SDK default; price as `"$0.05"` / `"$0.01"`) |
| Facilitator | `OKXFacilitatorClient` with `apiKey`, `secretKey`, `passphrase`; optional `baseUrl` default `https://web3.okx.com`. No separate facilitator URL required beyond that |
| Env | `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, payee wallet. This app uses `X402_PAYTO_ADDRESS` (alias `PAY_TO`) |
| Initialize | `resourceServer.initialize()` / `syncFacilitatorOnStart: true` on first request (serverless-friendly) |
| Success | Settlement proof on successful responses as `PAYMENT-RESPONSE` header (SDK) |
| 402 | Protocol challenge headers + optional `unpaidResponseBody` JSON |
| Peer dep | `@okxweb3/x402-next` requires `next@^16.0.10` (project upgraded to Next 16.2.10) |

**Playground split:** Production uses free `POST /api/playground/scan` (same-origin, 10/hour) so landing page works with `DEMO_MODE=false`. Paid agents use `/api/scan/*` only.

**Differences from first notes:** PAY_TO renamed preference to `X402_PAYTO_ADDRESS`; full `withX402` wiring is live in `lib/x402-server.ts`; optional `OKX_FACILITATOR_BASE_URL`.

---

## 2. ASP registration shape (HTTPS vs MCP)

**Agent DNA is A2MCP** (Agent-to-MCP): standardized API, fixed price per call, no negotiation.

From https://okx.ai/tutorial/asp and ASP registration notes:

| | A2A | A2MCP |
| --- | --- | --- |
| Best for | Complex negotiated tasks | Standardized API services |
| Pricing | Negotiated or fixed per task | Fixed price per call |
| Payment | Escrow on X Layer; release on approval | Pay-per-call or free; paid endpoints need x402 |

**Endpoint form:** Plain HTTPS endpoints that implement x402 for paid calls. Registration fields for A2MCP: **name, description, price (per call; 0 = free), endpoint**. The endpoint is the public URL of your service (described as "public address of your existing MCP" in registerasp docs; in practice this is the callable HTTPS URL).

**Not only a static MCP manifest:** Registration is done via Onchain OS agent prompts:

```
Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS
Help me list my ASP on OKX.AI using Onchain OS
```

Review: within 24 hours; result emailed to Agentic Wallet email and shown in agent conversation. Unreviewed ASPs can still be found by Agent ID.

**Listing fields (A2MCP):** name, description, price, endpoint. No hard public character limit found on the listing form itself. Skill-style `description` fields used for agent routing elsewhere are capped at **1024 characters** (Codex CLI); target ≤900 for headroom. We treat listing long descriptions as keyword-dense prose and keep short descriptions tight.

Sources:

- https://okx.ai/tutorial/asp
- https://web3.okx.com/onchainos/dev-docs/okxai/registerasp (via search index)
- https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp (DNS failed locally)

---

## 3. Skill / routing description patterns

From https://github.com/okx/agent-skills and https://github.com/okx/onchainos-skills:

- Each skill is Markdown + YAML frontmatter.
- `description` drives agent routing: enumerate literal natural-language trigger phrases.
- Description length: max 1024 chars; target ≤900.
- Install: `npx skills add okx/onchainos-skills --yes -g`

Agent DNA listing copy should include literal triggers: "check agent reputation before hiring", "vet an agent service provider", "score wallet trustworthiness", "verify token safety before swap", "detect risky token before trade", "pre-hire due diligence", "counterparty risk check".

---

## 4. Chain data source

### 4a. OKX OS Web3 API migration (2026-07-14)

The OKLink Explorer API (section 4b below, kept for history) was suspended for new keys; every call to its explorer endpoints returns 401. Data layer migrated to the OKX Onchain OS Web3 API on `web3.okx.com`. Do not use any OKLink-hosted API endpoint.

**Base URL:** `https://web3.okx.com` (paths under `/api/v6/`)

**Chain identifier:** `chainIndex` / `chains` = `196` for X Layer (confirmed in Supported Networks table; Wallet API, Trade, Market, Payments all checked for X Layer).

**Auth (confirmed at /onchainos/dev-docs/home/api-access-and-usage):**

- `OK-ACCESS-KEY`: API key from dev portal project
- `OK-ACCESS-TIMESTAMP`: ISO UTC, e.g. `2020-12-08T09:08:57.715Z`; must be within 30 seconds of server time
- `OK-ACCESS-PASSPHRASE`: passphrase chosen at key creation
- `OK-ACCESS-SIGN`: `Base64(HMAC-SHA256(timestamp + METHOD + requestPath + body, secretKey))`; requestPath includes query string for GET; body omitted for GET, raw JSON body included for POST
- No `OK-ACCESS-PROJECT` header on the v6 Onchain OS docs (that was old WaaS v5)

Key creation: web3.okx.com/build/dev-portal, Connect Wallet, verify signature, link email and phone, then create project (max 3) and API key (max 3 per project) with passphrase; secret shown via View details.

**Envelope:** `{ "code": "0", "msg": "", "data": [ ... ] }`. Non-zero code = error.

**Endpoints used by Agent DNA (all confirmed against live doc pages):**

| Purpose | Method / path | Tier |
| --- | --- | --- |
| Address balances | `GET /api/v6/dex/balance/all-token-balances-by-address?address=&chains=196` | Free |
| Tx history by address | `GET /api/v6/dex/post-transaction/transactions-by-address?address=&chains=196&cursor=&limit=20` | Free |
| Token metadata | `POST /api/v6/dex/market/token/basic-info` body `[{chainIndex, tokenContractAddress}]` | Basic |
| Token trading info (supply, holder count, liquidity) | `POST /api/v6/dex/market/price-info` body `[{chainIndex, tokenContractAddress}]` | Premium |
| Token risk and age (createTime, riskControlLevel, top10HoldPercent, honeypot and dev tags) | `/api/v6/dex/market/token/advanced-info` (verb not rendered in docs; POST assumed from sibling endpoints, smoke script verifies, GET fallback wired) | Premium |
| Token top holders | `GET /api/v6/dex/market/token/holder?chainIndex=196&tokenContractAddress=&cursor=&limit=` (top 100, `holdPercent`) | Premium |
| Token trades activity | `GET /api/v6/dex/market/trades?chainIndex=196&tokenContractAddress=&limit=` (max 500) | Basic |

**Tx history semantics:** 6-month window only, descending, cursor paging, max 20 records per request on a single chain. Response rows: `txHash`, `itype` (0 native, 1 internal, 2 token), `methodId`, `txTime` (ms), `from[]/to[]` `{address, amount}`, `tokenContractAddress`, `amount`, `symbol`, `txFee`, `txStatus` (`success|fail|pending`), `hitBlacklist`.

**Rate limits and pricing (from /onchainos/dev-docs/market/market-api-fee):** no published per-endpoint RPS; free endpoints cost nothing; Basic tier 100K free calls/month then $0.0001/call; Premium tier 100K free calls/month then $0.0002/call; overage billed via x402 or subscription in USDG/USDT on X Layer. Exhausted quota returns HTTP 402; client surfaces it as RateLimited with a quota message.

**Endpoint gaps found (no equivalent, do not invent):**

1. Contract source verification status: no endpoint on OKX OS Web3 API. Old `verified` flag replaced by `communityRecognized` (basic-info tagList) plus `riskControlLevel` and honeypot/dev tags (advanced-info). Scoring weight redistributed; flag text notes the substitution.
2. Address summary since genesis (total tx count, true first-seen): only derivable from the 6-month tx window. `AddressSummary` now carries `historyWindowDays = 183`; longevity is computed from observed age only and confidence is reduced when the window saturates.
3. ERC-20 transfer event list: no raw transfer endpoint. Replaced by DEX trades activity (`/market/trades`); transfer-pattern scoring reworked to trade-pattern scoring (trader diversity, one-sided buy/sell flow).
4. Total supply: only `circSupply` (circulating) available via price-info; stored in `totalSupply` field, treated as supply signal.

**DNS note:** `*.okx.com` fails to resolve on this dev machine (ISP-level DNS filtering; even direct connect to the Cloudflare IP times out). Docs were fetched via r.jina.ai proxy. Production (Vercel) resolves fine. Local smoke runs need a VPN or a DNS override; smoke script prints a clear hint when it sees ENOTFOUND.

### 4b. OKLink Explorer API (dead, historical)

The original data layer was built on the OKLink Explorer API (explorer-style endpoints under an `/api/v5/explorer` prefix, `chainShortName=XLAYER`, same OK-ACCESS signed headers). That API was suspended in May 2025; new keys receive 401 on every endpoint even with correct signing. The docs pages remained online, which is why Phase 0 research initially picked it. Old endpoint table removed so no dead URLs linger in this repo. Full mapping from old fetchers to OKX OS endpoints is in section 4a.

---

## 5. Stablecoins and settlement

**Network:** X Layer mainnet only: `eip155:196`.

**Default payment token (SDK auto-config):** USDT0  
`0x779Ded0c9e1022225f8E0630b35a9b54bE713736` (6 decimals).

**Spec vs docs deviation:** Product brief said USDT or USDG. Official OKX Payments SDK documents **USDT0 on X Layer** as the default settlement asset. We settle in **USDT0** and declare prices as USD strings (`$0.05` / `$0.01`) which the SDK converts to USDT0 atomic units. USDG is not listed as the default in SELLER.md. Recorded here so listing copy says USDT0 / USDT-equivalent, not inventing USDG support.

**Scheme for Agent DNA:** `exact` (fixed price per call, EIP-3009 gasless authorization).

---

## 6. Implementation decisions from research

1. A2MCP + x402 HTTPS endpoints on Vercel (Next.js App Router).
2. `lib/payment.ts` wraps verification; `DEMO_MODE=true` for playground; production requires OKX SA credentials + `PAY_TO`.
3. Prefer dynamic/optional use of `@okxweb3/x402-*` when credentials exist; otherwise explicit 402, never silent pass.
4. OKX OS Web3 API (`lib/chaindata.ts`) as sole chain data source for X Layer; pure scoring in `lib/dna.ts` and `lib/tokenscan.ts`.
5. Listing assets in `docs/listing.md` with keyword-dense triggers and A2MCP registration fields.
