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

## 4. OKLink X Layer API

**Base URL:** `https://www.oklink.com/api/v5/explorer`

**Auth header:** `Ok-Access-Key: <OKLINK_API_KEY>`

**Chain short name for X Layer:** `XLAYER` (also appears as `XLAYER` / `XLAYER_TESTNET` in contract verification plugin support lists).

**Endpoints used by Agent DNA** (from community SDKs and OKLink docs structure):

| Purpose | Method / path |
| --- | --- |
| Address summary | `GET /address/address-summary?chainShortName=XLAYER&address=` |
| Normal txs | `GET /address/normal-transaction-list?chainShortName=XLAYER&address=&page=&limit=` |
| Token txs for address | `GET /address/token-transaction-list?chainShortName=XLAYER&address=&page=&limit=` |
| Token list / info | `GET /token/token-list?chainShortName=XLAYER&protocolType=token_20&tokenContractAddress=&page=&limit=` |
| Contract verified info | `GET /contract/verify-contract-info?chainShortName=XLAYER&contractAddress=` |
| Token holders (best effort) | `GET /token/position-list?chainShortName=XLAYER&tokenContractAddress=&page=&limit=` (path may vary; client tries known aliases and degrades gracefully) |
| Token transfers | `GET /token/token-transaction-list?chainShortName=XLAYER&tokenContractAddress=&page=&limit=` or address token-tx list filtered by contract |

**Response envelope:**

```json
{ "code": "0", "msg": "", "data": [ ... ] }
```

**Address summary fields (typed from open source adapters):** `firstTransactionTime`, `lastTransactionTime`, `transactionCount`, `balance`, `balanceSymbol`, `address`, `verifying`, etc.

**Rate limits:** Official public rate-limit numbers were not available in the pages we could load. Treat as shared API quota; use request timeouts, one retry with backoff on 5xx, and thin per-invocation in-memory cache. Free tier historically advertised large monthly call budgets on blog posts; do not rely on an exact number without a portal screenshot.

**API key:** Apply via OKLink docs quickstart: https://www.oklink.com/docs/en/#quickstart-guide-getting-started

**Risk flag:** Moralis migration guides (2025) claimed OKLink Explorer API suspension. As of 2026-07-13 the docs and explorer still present X Layer endpoints and third-party SDKs still call them. Monitor for deprecation. If OKLink blocks or retires endpoints, swap the data layer only (`lib/oklink.ts`); scoring stays pure.

Sources:

- https://www.oklink.com/docs/en/
- https://github.com/dapplink-labs/chain-explorer-api (oklink adapter)
- https://docs.rs/oklink (Rust client: base `https://www.oklink.com/api/v5/explorer`, header `Ok-Access-Key`)

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
4. OKLink as sole chain data source for X Layer; pure scoring in `lib/dna.ts` and `lib/tokenscan.ts`.
5. Listing assets in `docs/listing.md` with keyword-dense triggers and A2MCP registration fields.
