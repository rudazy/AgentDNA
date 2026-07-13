# Agent DNA: Build Plan

Date: 2026-07-13
Builder: Ludarep (rudazy)

## Current Task

x402 live settlement wiring complete. Awaiting Ludarep keys, Vercel env, and one real paid smoke call.

## x402 wiring phases

- [x] Phase 0: SELLER.md confirmed; notes updated (withX402, USDT0, facilitator, PAYMENT-RESPONSE)
- [x] Phase 1: Install @okxweb3/x402-*, Next 16 peer, wrap paid routes via protectWithX402
- [x] Phase 2: POST /api/playground/scan free route; UI points there; curl examples stay paid
- [x] Phase 3: Recolor to lime #c8f135 + gold #f5c842 only (no magenta/violet/coral)
- [x] Phase 4: Unit tests (402 shape, playground rate limit), tsc + build clean, RUNBOOK updated

## UI pass: professional redesign (same session)

- Removed glass panels, particle canvas, chips, hex seal, corner ornaments, glow gradients
- Typographic layout: Geist Sans body, mono only for data/code
- Quiet surfaces (#111 + #1f1f1f borders), 4px radius, solid lime CTA
- Radar remains the single visual signature on results

## What changed (this session)

### Code

- `lib/x402-server.ts`: OKXFacilitatorClient + ExactEvmScheme + withX402 wrapper
- `lib/x402-challenge.ts`: pure unpaid 402 body for tests/docs
- `lib/scan-service.ts`: HTTP-free agent/token scan orchestration
- `app/api/scan/agent` and `token`: thin handlers + `protectWithX402`
- `app/api/playground/scan`: free same-origin, 10/hour IP window limit, `playground: true`
- Playground UI calls free route; paid curl block unchanged
- Next upgraded to 16.2.10 for x402-next peer dep
- UI recolored lime/gold (mobile-friendly layout kept)

### Env (.env.example)

- `X402_PAYTO_ADDRESS` (primary payee)
- `PAY_TO` alias
- `OKX_API_KEY` / `OKX_SECRET_KEY` / `OKX_PASSPHRASE`
- `OKX_FACILITATOR_BASE_URL` optional
- `DEMO_MODE` semantics documented

### Tests

- 33 tests pass (dna, tokenscan, x402 challenge shape, rate limit 11th=blocked, same-origin)
- tsc clean, next build clean (routes include playground)

## Manual decisions still on Ludarep

1. Set production secrets on Vercel (OKLink + OKX SA + X402_PAYTO_ADDRESS, DEMO_MODE=false)
2. Confirm payTo wallet holds/receives USDT0 on X Layer
3. One real paid call from an x402 client to verify settlement lands
4. Register/list A2MCP on OKX.AI
5. Git commit/push (agent never git-writes)

## Blockers

- None in code. Live settlement cannot be fully exercised without Ludarep OKX SA credentials and a paying client.
