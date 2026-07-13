# Lessons: Agent DNA

## Session 2026-07-13

- OKX Payments seller path is x402 with packages `@okxweb3/x402-core`, `@okxweb3/x402-evm`, `@okxweb3/x402-next`. Always `OKXFacilitatorClient`, never invent facilitator clients.
- Call `await resourceServer.initialize()` before handling paid traffic when using the full SDK server object.
- x402 price strings use `"$0.05"`; MPP uses atomic base units. Do not mix formats across SDK families.
- Default settlement asset on X Layer is USDT0 `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`, network `eip155:196`.
- OKLink base is `https://www.oklink.com/api/v5/explorer` with header `Ok-Access-Key`. chainShortName for X Layer is `XLAYER`.
- A2MCP listing fields: name, description, price per call, endpoint. Keyword-dense descriptions improve agent routing.
- Never silently fake payment verification when DEMO_MODE is off.
- No em dashes, no emojis, no blue/cyan in any UI state.

## Session 2026-07-13 (x402 wiring)

- `@okxweb3/x402-next@0.1.1` peer-depends on `next@^16`. Pin Next 16 when installing that package; Next 15 fails ERESOLVE.
- Keep pure challenge builders (`lib/x402-challenge.ts`) free of `@okxweb3/x402-next` imports so Vitest can unit-test 402 body shape without loading `next/server` from the SDK.
- Prefer `withX402` on App Router handlers over inventing verify logic; set `syncFacilitatorOnStart: true` for serverless cold starts.
- Free playground must be a separate route when production turns DEMO_MODE off. Same-origin + windowed rate limit is the minimum abuse control.
- Brand accents after UI experiments: lime `#c8f135` primary interactive, gold `#f5c842` for money/grades only.
