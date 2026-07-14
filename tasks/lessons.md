# Lessons: Agent DNA

## Session 2026-07-13

- OKX Payments seller path is x402 with packages `@okxweb3/x402-core`, `@okxweb3/x402-evm`, `@okxweb3/x402-next`. Always `OKXFacilitatorClient`, never invent facilitator clients.
- Call `await resourceServer.initialize()` before handling paid traffic when using the full SDK server object.
- x402 price strings use `"$0.05"`; MPP uses atomic base units. Do not mix formats across SDK families.
- Default settlement asset on X Layer is USDT0 `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`, network `eip155:196`.
- Chain data auth is full OKX OS signing (OK-ACCESS-KEY/SIGN/TIMESTAMP/PASSPHRASE), not key-only. (Superseded 2026-07-14: OKLink Explorer API is dead; see the data layer migration lesson below.)
- A2MCP listing fields: name, description, price per call, endpoint. Keyword-dense descriptions improve agent routing.
- Never silently fake payment verification when DEMO_MODE is off.
- No em dashes, no emojis, no blue/cyan in any UI state.

## Session 2026-07-13 (x402 wiring)

- `@okxweb3/x402-next@0.1.1` peer-depends on `next@^16`. Pin Next 16 when installing that package; Next 15 fails ERESOLVE.
- Keep pure challenge builders (`lib/x402-challenge.ts`) free of `@okxweb3/x402-next` imports so Vitest can unit-test 402 body shape without loading `next/server` from the SDK.
- Prefer `withX402` on App Router handlers over inventing verify logic; set `syncFacilitatorOnStart: true` for serverless cold starts.
- Free playground must be a separate route when production turns DEMO_MODE off. Same-origin + windowed rate limit is the minimum abuse control.
- Brand accents after UI experiments: lime `#c8f135` primary interactive, gold `#f5c842` for money/grades only.

## Session 2026-07-14 (data layer migration: OKLink to OKX OS)

- Cause: the OKLink Explorer API was suspended in May 2025 but its docs pages stayed online, so Phase 0 research picked a dead API. New keys got 401 on every endpoint even with correct signing. Lesson: docs being reachable does not prove the API is alive. Before building on a third-party API, make one real authenticated call from a throwaway script and confirm a 200 with data; treat suspension rumors in migration guides (Moralis flagged this one in 2025) as blockers to verify, not footnotes.
- Replacement: OKX OS Web3 API on `web3.okx.com`, paths under `/api/v6/`, chainIndex `196` for X Layer, same OK-ACCESS signed-header scheme. Endpoint map and gaps live in tasks/notes.md section 4a.
- When a data source swap loses a signal (contract verification, full history depth, raw transfer lists), adjust the scoring to the data that exists and lower confidence; never keep a trait silently computed from a signal that no longer arrives.
- Keep the data layer isolated (one module, typed errors, pure scoring elsewhere): this migration only had to replace `lib/oklink.ts` with `lib/chaindata.ts` and adjust scoring inputs, exactly because scoring never fetched anything itself.
- This dev machine's resolver blocks okx.com domains entirely (DNS filtered, direct IP connect also fails). Fetch OKX docs via a render proxy; run live smokes behind a VPN or on Vercel.
