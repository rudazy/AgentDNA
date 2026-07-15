# OKX.AI Listing Copy: Agent DNA

Use these fields when registering and listing the A2MCP ASP via Onchain OS.

## Registration type

A2MCP (Agent-to-MCP). Fixed price per call. x402-paid HTTPS endpoints.

## Name

Agent DNA

## Short description

(Keep under ~200 characters for UI cards; expand if the form allows more.)

Onchain trust scans for agents and tokens on X Layer. Behavioral DNA grades, delivery probability, and token safety scores before hire or swap.

## Long description (keyword dense for agent routing)

Agent DNA is a trust engine for the OKX.AI agent marketplace on X Layer. Call it when you need to check agent reputation before hiring, vet an agent service provider, score wallet trustworthiness, verify token safety before swap, detect risky token before trade, run pre-hire due diligence, or perform a counterparty risk check.

Two paid endpoints, one engine:

1. Agent Scan (POST /api/scan/agent) reads onchain behavioral history for an agent identity or wallet and returns six DNA traits (reliability, consistency, longevity, risk appetite, activity, counterparty diversity), an overall grade A+ through F (UNRATED when confidence is below 15), confidence, and a deliveryProbability labeled as a heuristic estimate.
2. Token Scan (POST /api/scan/token) reads token contract, holder, and transfer data and returns a safety score 0-100, riskLevel (LOW, MEDIUM, HIGH, CRITICAL), flags, confidence, and a plain-language explanation.

Settlement: USDT0 on X Layer via x402 exact scheme (OKX Payment SDK). Unpaid calls return HTTP 402 with accept details. No negotiation. No escrow wait for A2MCP.

Trigger phrases for routing: check agent reputation before hiring; vet an agent service provider; score wallet trustworthiness; verify token safety before swap; detect risky token before trade; pre-hire due diligence; counterparty risk check; agent DNA; token safety scan; wallet trust score; X Layer agent reputation.

Built by Ludarep. Stateless Next.js on Vercel.

## Services / pricing (A2MCP fields)

| Service | Method | Path | Price per call | Currency / network |
| --- | --- | --- | --- | --- |
| Agent Scan | POST | /api/scan/agent | 0.05 | USDT0 on X Layer (declare as $0.05 in x402) |
| Token Scan | POST | /api/scan/token | 0.01 | USDT0 on X Layer (declare as $0.01 in x402) |

If the form takes a single price, register two services with the prices above. Free price is not used; set DEMO_MODE only on the deploy used for the public playground if desired, or keep production DEMO_MODE=false and rely on payment.

## Endpoint

```
https://agentdnas.vercel.app
```

Concrete paths:

- `https://agentdnas.vercel.app/api/scan/agent`
- `https://agentdnas.vercel.app/api/scan/token`
- `https://agentdnas.vercel.app/api/health`

## Request body (both scans)

```json
{ "address": "0x..." }
```

## Payment headers (x402)

- `PAYMENT-SIGNATURE` or `X-PAYMENT`
- or `Authorization: Payment <payload>`

## Registration prompts (Onchain OS)

```
Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS
```

```
Help me list my ASP on OKX.AI using Onchain OS
```

Provide: name Agent DNA, description (short or long above), price per service, endpoint URL.

## Review notes

Review window: within 24 hours per OKX.AI ASP tutorial. Result goes to Agentic Wallet email and agent conversation. Unreviewed listings remain reachable by Agent ID.
