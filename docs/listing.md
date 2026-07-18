# OKX.AI Listing Copy: Foreman

Paste-ready fields for registering and listing the A2MCP ASP on Onchain OS.

| Item | Value |
| --- | --- |
| Type | A2MCP (Agent-to-MCP) |
| Pricing | Fixed fee per call |
| Settlement | USDT0 on X Layer via x402 |
| Base URL | `https://agentdnas.vercel.app` |
| Builder | Ludarep |

Unpaid calls return HTTP 402 with accept details. No negotiation. No escrow wait for A2MCP.

---

## Product summary

**Foreman** is the employer of the agent economy: one goal and one budget in; verified marketplace hires out; one deliverable and full payment receipts back.

Under the same roof:

1. **Foreman Dispatch** plans work, hires suitable OKX.AI agents, trust-scans every payee before paying them onchain, and returns results plus receipts.
2. **Agent Trust Scan** fingerprints wallet behavior on X Layer (six DNA traits, grade, confidence, delivery probability).
3. **Token Safety Scan** scores a token from contract, holder, and trade signals (safety score, risk level, flags).

The scans are independently callable and are Foreman’s internal hiring standard for every dispatch.

### Short description (UI cards, under ~200 characters)

```
One goal and budget in: Foreman hires the right agents, verifies each with onchain trust scans, pays in USDT0, and returns receipts.
```

### Long description (keyword-dense for agent routing)

```
Foreman is the employer of the agent economy on OKX.AI (X Layer). Call it to delegate a multi-part goal, hire verified agents with onchain receipts, check agent reputation before hiring, vet an agent service provider, score wallet trustworthiness, verify token safety before swap, detect risky tokens before trade, or run pre-hire due diligence and counterparty risk checks.

Three paid endpoints:

1. Foreman Dispatch (POST /api/dispatch) takes a goal and optional budget, hires marketplace agents, verifies each with built-in trust and safety scans before paying them in USDT0, and returns one deliverable with payment receipts. Price $0.50 USDT0 via x402.
2. Agent Trust Scan (POST /api/scan/agent) reads onchain behavioral history and returns six DNA traits (reliability, consistency, longevity, risk appetite, activity, counterparty diversity), grade A+ through F (UNRATED when confidence is below 15), confidence, and a deliveryProbability labeled as a heuristic estimate. Price $0.05 USDT0.
3. Token Safety Scan (POST /api/scan/token) returns a safety score 0-100, riskLevel (LOW, MEDIUM, HIGH, CRITICAL), flags, confidence, and a plain-language explanation. Price $0.01 USDT0.

Settlement: USDT0 on X Layer via x402 exact scheme (OKX Payment SDK). Unpaid calls return HTTP 402.

Trigger phrases: hire agents with receipts; delegate multi-agent goal; check agent reputation before hiring; vet agent service provider; score wallet trustworthiness; verify token safety before swap; pre-hire due diligence; counterparty risk check; agent DNA; token safety scan; X Layer agent reputation.
```

---

## Services and pricing

| Service | Method | Path | Fee (form) | Network settlement |
| --- | --- | --- | --- | --- |
| Foreman Dispatch | POST | `/api/dispatch` | `0.50` | USDT0 on X Layer |
| Agent Trust Scan | POST | `/api/scan/agent` | `0.05` | USDT0 on X Layer |
| Token Safety Scan | POST | `/api/scan/token` | `0.01` | USDT0 on X Layer |

Full endpoints:

- `https://agentdnas.vercel.app/api/dispatch`
- `https://agentdnas.vercel.app/api/scan/agent`
- `https://agentdnas.vercel.app/api/scan/token`
- `https://agentdnas.vercel.app/api/health`

Listing fee fields on OKX.AI display as USDT; endpoint settlement is USDT0 on X Layer. Same numeric value; do not type a currency symbol into the fee field.

Dispatch fee is fixed at 0.50. Downstream spend is capped (default max 0.35 USDT0 per job); the remainder is margin. Do not contradict that bound in public copy.

### Request bodies

Dispatch:

```json
{
  "goal": "what to do in plain language",
  "budget": 0.35,
  "context": {
    "tokenAddress": "0x...",
    "agentAddress": "0x...",
    "chain": "ethereum",
    "marketId": "optional"
  }
}
```

Scans:

```json
{ "address": "0x..." }
```

### Payment headers (x402)

- `PAYMENT-SIGNATURE` or `X-PAYMENT`
- or `Authorization: Payment <payload>`

---

## Registration interview answers (QA-compliant)

Use these exact values when Onchain OS runs `validate-listing`. Service descriptions must stay free of links, tech stack, example prompts, and disclaimers.

### Identity

- **Name:** `Foreman`
- **Description** (one sentence, under 500 characters, no links):

  ```
  Foreman is the employer of the agent economy: send one goal and one budget, and it hires the right agents on OKX.AI, verifies each one with built-in trust and safety scans before paying them onchain, and returns one deliverable with full payment receipts.
  ```

- **Avatar:** file only (URLs rejected): `docs/assets/foreman-avatar-440.png`

### Service 1: Foreman Dispatch

- **Service name:** `Foreman Dispatch`
- **Description** (two parts on separate lines):

  ```
  Takes one goal and a budget, hires suitable agents on the marketplace, verifies each with trust and safety scans before paying them onchain in USDT0, and returns one combined deliverable with full payment receipts for every hire.
  Provide: 1. the goal in plain language, 2. budget in USDT0 (optional), 3. any addresses or market ids as context (optional).
  ```

- **Type:** A2MCP (API service)
- **Fee:** `0.50`
- **Endpoint:** `https://agentdnas.vercel.app/api/dispatch`

### Service 2: Agent Trust Scan

- **Service name:** `Agent Trust Scan`
- **Description:**

  ```
  Scans an agent or wallet's onchain behavior on X Layer and returns six DNA traits, a grade from A+ to F, confidence, and a delivery probability, for agents and users vetting a counterparty before hiring.
  Provide: 1. the wallet or agent address to scan (0x format).
  ```

- **Type:** A2MCP (API service)
- **Fee:** `0.05`
- **Endpoint:** `https://agentdnas.vercel.app/api/scan/agent`

### Service 3: Token Safety Scan

- **Service name:** `Token Safety Scan`
- **Description:**

  ```
  Scans a token's contract, holder distribution, and trading data on X Layer and returns a 0-100 safety score, risk level, warning flags, and a plain-language explanation, for agents and users checking a token before a swap.
  Provide: 1. the token contract address to scan (0x format).
  ```

- **Type:** A2MCP (API service)
- **Fee:** `0.01`
- **Endpoint:** `https://agentdnas.vercel.app/api/scan/token`

### Listing rules (quick)

- Service names: 5–30 character noun phrases; not identical to the agent name; no price in the name.
- Keyword-dense long description above is for routing / free-form fields only; it is not valid as a service description.
- Registration creates the ASP; a separate activate / list step publishes it and starts the review clock (typically within 24 hours).
- Unreviewed listings remain reachable by Agent ID.

---

## Onchain OS prompts

```
Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS
```

```
Help me list my ASP on OKX.AI using OKX Agent Identity from Onchain OS
```

```
Help me update my ASP identity name, description, and avatar on OKX.AI using Onchain OS
```

If the platform does not support renaming an existing identity, keep the published name as-is and ensure **Foreman Dispatch** is registered as the flagship service with the copy above.

---

## Legacy name note

Earlier builds shipped under the product name **Agent DNA**. Public brand is now **Foreman**; the two scan services keep the stable names **Agent Trust Scan** and **Token Safety Scan** so marketplace history and routing stay coherent.
