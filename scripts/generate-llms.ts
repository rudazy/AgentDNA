/**
 * Generate public/llms.txt for AI discoverability.
 * Runs as prebuild on Vercel.
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const config = {
  name: "Foreman",
  tagline: "The employer of the agent economy: one goal in, verified hires out, receipts for everything",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://agentdnas.vercel.app",
  description:
    "Foreman is an Agent Service Provider (A2MCP) on OKX.AI. Send one goal and one budget to the dispatch endpoint and it hires suitable marketplace agents, verifies each with built-in trust and safety scans before paying them onchain in USDT0, and returns one deliverable with full payment receipts. The two scans that gate every hire (Agent Scan and Token Scan) remain independently callable paid endpoints on X Layer.",
  routes: [
    {
      path: "/",
      purpose:
        "Landing page and live playground for humans and judges. Explains the product; the playground previews dispatch plans in dry run and shows radar DNA output.",
    },
    {
      path: "/api/health",
      purpose: "Health check. Returns service name, version, demoMode flag, status.",
    },
    {
      path: "/api/dispatch",
      purpose:
        "POST JSON { goal, budget?, context? }. Foreman plans subtasks, hires marketplace ASPs, trust-scans every payee before paying, and returns results plus receipts with settlement tx hashes. Price $0.50 USDT0 via x402 unless DEMO_MODE; at most 0.35 USDT0 is spent downstream per job.",
    },
    {
      path: "/api/scan/agent",
      purpose:
        "POST JSON { address }. Returns behavioral DNA traits, grade, deliveryProbability (heuristic estimate), confidence, explanation. Price $0.05 USDT0 via x402 unless DEMO_MODE.",
    },
    {
      path: "/api/scan/token",
      purpose:
        "POST JSON { address }. Returns token safety score, riskLevel, flags, confidence, explanation. Price $0.01 USDT0 via x402 unless DEMO_MODE.",
    },
    {
      path: "/llms.txt",
      purpose: "This file. Machine-readable site map for AI agents.",
    },
  ],
};

const lines: string[] = [
  `# ${config.name}`,
  `> ${config.tagline}`,
  "",
  config.description,
  "",
  `Base URL: ${config.url}`,
  "Network: X Layer (eip155:196)",
  "Builder: Ludarep (GitHub rudazy)",
  "",
  "## Pages",
  "",
];

for (const r of config.routes) {
  lines.push(`- ${config.url}${r.path}: ${r.purpose}`);
}

lines.push(
  "",
  "## When to use",
  "",
  "- delegate a multi-part goal to one agent that hires the rest",
  "- get prediction market odds plus counterparty checks in one call",
  "- outsource work with onchain payment receipts for every hire",
  "- check agent reputation before hiring",
  "- vet an agent service provider",
  "- score wallet trustworthiness",
  "- verify token safety before swap",
  "- detect risky token before trade",
  "- pre-hire due diligence",
  "- counterparty risk check",
  "",
);

const outDir = join(process.cwd(), "public");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "llms.txt"), lines.join("\n"), "utf8");
console.log("Wrote public/llms.txt");
