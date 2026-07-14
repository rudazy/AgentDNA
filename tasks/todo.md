# Agent DNA: Build Plan

Date: 2026-07-14
Builder: Ludarep (rudazy)

## Current Task

Data layer migration OKLink to OKX OS Web3 API: COMPLETE in code. Remaining: Ludarep sets OKXOS_* secrets and runs the live smoke (blocked locally by DNS filtering of okx.com; run behind VPN or verify on Vercel).

## Data layer migration (2026-07-14 session)

Cause: OKLink Explorer API was suspended in May 2025; docs stayed online so Phase 0 originally picked it. Every new key gets 401. Full research notes in tasks/notes.md section 4a; the mistake pattern is recorded in tasks/lessons.md.

- [x] Phase 0: Live OKX OS docs read (via r.jina.ai; local resolver blocks okx.com). Auth scheme, endpoints, chainIndex 196, fee tiers recorded in notes.md 4a
- [x] Phase 1: `lib/chaindata.ts` created (signed helper, timeout, one retry on 5xx, typed errors NotFound / RateLimited / Upstream / AuthFailed). `lib/oklink.ts` deleted; nothing imports it
- [x] Phase 1: Env renamed to `OKXOS_API_KEY` / `OKXOS_SECRET_KEY` / `OKXOS_PASSPHRASE`; legacy `OKLINK_*` still read as fallbacks so the existing `.env.local` works unchanged
- [x] Phase 2: Scoring adjusted for data gaps (details below), weights in config objects, all scoring still pure and deterministic
- [x] Phase 3: 70 tests pass, tsc clean, next build clean; `scripts/smoke-chaindata.ts` added; RUNBOOK / README / .env.example updated; em dash and emoji greps empty; zero OKLink API URLs anywhere

### Endpoint gaps found and scoring adjustments

1. Contract source verification: no OKX OS endpoint. The verification component (old weight 0.35) is replaced by trust signals: `communityRecognized` (basic-info), `riskControlLevel` 0-5 and honeypot tag (advanced-info). New weights in `TOKEN_SCORE_WEIGHTS`: trust 0.20, holders 0.30, age 0.20, trades 0.20, supply 0.10. When neither trust signal exists, the flag "Contract verification status unavailable on this data source; trust signal limited" is emitted and confidence drops.
2. Address history is a 6-month window (transactions-by-address). `AddressSummary` gained `historyWindowDays` / `historyWindowCapped`; longevity scores observed age only (never extrapolated); confidence is multiplied by 0.85 when the window saturates and the explanation says so.
3. Raw ERC-20 transfer lists: not available. Replaced by DEX trades (`/market/trades`); `scoreTransferPatterns` became `scoreTradePatterns` (trader diversity, one-sided buy/sell flow, dominant-trader penalty). `TokenTransfer` type replaced by `TokenTrade`.
4. Total supply: only circulating supply (`circSupply`) exists; stored in `totalSupply`.
5. Holder concentration: BETTER than before. Top 100 holders with `holdPercent` (`/market/token/holder`) plus direct `top10HoldPercent` from advanced-info as fallback when the list is empty. "Holder distribution unavailable on this data source" flag only when both are missing.
6. advanced-info HTTP verb is not rendered in the docs; client tries POST (like its siblings) with GET fallback. The smoke script confirms the working verb live.

### Files changed

- New: `lib/chaindata.ts`, `lib/chaindata.test.ts`, `scripts/smoke-chaindata.ts`
- Deleted: `lib/oklink.ts`, `lib/oklink.test.ts`, `scripts/smoke-oklink.ts`, `scripts/probe-auth.ts`
- Updated: `lib/types.ts` (AddressSummary window fields, TokenInfo trust fields, TokenTrade), `lib/tokenscan.ts` (trust/trade scoring), `lib/dna.ts` (window-capped confidence + explanation), `lib/scan-service.ts` (rewired), `lib/dna.test.ts`, `lib/tokenscan.test.ts`, `scripts/check-env.ts`, `.env.example`, `RUNBOOK.md`, `README.md`, `docs/demo-script.md`, `tasks/notes.md`, `tasks/lessons.md`

## Brand assets (same session)

- [x] `app/icon.svg`: favicon. The DnaRadar trait polygon reduced to one glyph: dark #0a0a0a rounded tile, faint lime hex ring, irregular polygon with lime-to-gold gradient stroke, three vertex dots. Legible at 16px
- [x] `app/apple-icon.tsx`: 180x180 PNG (ImageResponse), same mark full-bleed on #0a0a0a (iOS applies its own mask)
- [x] `app/opengraph-image.tsx`: 1200x630 PNG mirroring the hero: section label rule, "Every agent has DNA." in ink with gradient second line, muted tagline, X LAYER / X402 PAID / OKX.AI chips, full hex radar right, glass-panel border frame, subtle lime and gold glows. Geist Mono 400/600 TTFs stored in `app/` and read at build time (route is statically prerendered, no runtime font fetch)
- [x] `app/layout.tsx`: twitter summary_large_image card added; og:image and twitter:image resolve through metadataBase
- [x] Verified by rendering: build clean, all three routes prerendered static, PNGs visually checked, head tags confirmed (og:image, twitter:card, icon, apple-touch-icon)
- Note: Turbopack does not support the `fetch(new URL(..., import.meta.url))` font pattern in the Node runtime; fs.readFile at build time is the working approach

## Production domain wired (same session)

- [x] `https://agentdnas.vercel.app` set everywhere a domain was needed: layout metadataBase fallback, HowAgentsCall curl examples, generate-llms.ts fallback URL, public/llms.txt (regenerated), RUNBOOK Vercel env + paid smoke curl, docs/listing.md endpoint fields, README live link
- [x] Verified on a local production server: og:image and on-page curl examples resolve to agentdnas.vercel.app; no YOUR_DOMAIN / YOUR_PRODUCTION_DOMAIN / agent-dna.vercel placeholders remain; build clean, 70 tests pass
- Reminder: still set `NEXT_PUBLIC_SITE_URL=https://agentdnas.vercel.app` in Vercel env so a future custom domain only needs the env change

## x402 wiring phases (previous sessions, unchanged)

- [x] Phases 0-4 complete: withX402 on paid routes, free playground route, lime/gold UI, 402 challenge tests, RUNBOOK

## Manual decisions still on Ludarep

1. Run the live chain data smoke: `npx tsx scripts/smoke-chaindata.ts` behind a VPN (local ISP DNS blocks okx.com), or verify on a Vercel preview. Confirms the advanced-info verb and real data shapes
2. Set production secrets on Vercel: `OKXOS_API_KEY`, `OKXOS_SECRET_KEY`, `OKXOS_PASSPHRASE` (plus existing OKX SA x402 vars and `X402_PAYTO_ADDRESS`, `DEMO_MODE=false`)
3. Confirm payTo wallet holds/receives USDT0 on X Layer
4. One real paid call from an x402 client to verify settlement lands
5. Register/list A2MCP on OKX.AI
6. Git commit/push yourself (agent never git-writes)

## Known issues / next up

- `npm run lint` is broken repo-wide: `next lint` was removed in Next 16. Pre-existing, untouched this session. Fix later by switching the script to `eslint .` and adjusting `eslint.config.mjs` globs
- Token holder endpoint response field names for the holder address are not in the docs table; `mapHolders` accepts several candidates. Verify against real data during the live smoke and tighten the type
- Premium Market endpoints (holders, price-info, advanced-info) have a 100K/month free quota; 402 maps to RateLimited with a quota message

## Blockers

- Live smoke cannot run from this machine (ISP-level DNS filtering of okx.com; direct IP connect also blocked). Everything else verified offline.
