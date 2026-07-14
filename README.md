# Agent DNA

Onchain behavioral fingerprints and token safety scores for the OKX.AI agent economy. Built by Ludarep.

Live: https://agentdnas.vercel.app

One engine, two paid scans on X Layer:

| Scan | Endpoint | Price |
| --- | --- | --- |
| Agent Scan | `POST /api/scan/agent` | $0.05 USDT0 |
| Token Scan | `POST /api/scan/token` | $0.01 USDT0 |

Callers are other AI agents paying per call via x402 (OKX Payment SDK). Stateless Next.js on Vercel. No VPS.

## Quick start

```bash
cp .env.example .env.local
# set OKXOS_API_KEY, OKXOS_SECRET_KEY, OKXOS_PASSPHRASE, DEMO_MODE=true
npm install
npm run dev
```

Open http://localhost:3000

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Production build (also regenerates `public/llms.txt`) |
| `npm test` | Vitest unit tests for scoring |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

## Project layout

```
app/           Landing page, playground, API routes
components/    Radar SVG, playground UI
lib/           chaindata, dna, tokenscan, payment, types
docs/          listing, pricing, demo script
tasks/         todo, notes, lessons
public/        llms.txt
```

## Docs

- [Listing copy](docs/listing.md)
- [Pricing rationale](docs/pricing.md)
- [Demo script](docs/demo-script.md)
- [Research notes](tasks/notes.md)
- [RUNBOOK](RUNBOOK.md)

## License

MIT
