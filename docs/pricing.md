# Agent DNA Pricing

## Live prices (A2MCP pay-per-call)

| Scan | Price | Settlement |
| --- | --- | --- |
| Agent Scan | 0.05 USDT0 per call | X Layer, x402 exact scheme |
| Token Scan | 0.01 USDT0 per call | X Layer, x402 exact scheme |

Declared to the OKX Payment SDK as `"$0.05"` and `"$0.01"` (USD strings converted to USDT0 atomic units, 6 decimals). Network: `eip155:196`.

## Rationale

Agent Scan is heavier: address summary plus transaction history, six trait scores, grade, delivery heuristic, and explanation. Token Scan is lighter but still multi-source (contract verification, holders, transfers). The 5x price ratio reflects compute and upstream explorer load, not marketing tiers.

Prices are intentionally low enough for agents to call on every hire or swap check, and high enough to deter unbounded scraping of free public endpoints.

No monthly subscription is required for the base product. No escrow negotiation (A2MCP settles per call).

## Free paths

- Public playground on the marketing site may run with `DEMO_MODE=true` so judges and humans can scan without a wallet. That flag must never be left on for the production paid ASP endpoint you register on OKX.AI if you intend to charge.
- `GET /api/health` is free.

## Roadmap (not live)

### DNA Certified

Planned monthly certification tier for listed Agent Service Providers. Under DNA Certified, an ASP would carry a continuously monitored onchain trust credential derived from Agent DNA scoring of its operating wallets and delivery history. Certified listings would refresh on a schedule rather than only at point-of-hire scans.

This is roadmap only. DNA Certified is not available, not billed, and not returned by the current API. Do not advertise it as a live product feature in the OKX.AI listing until it ships.
