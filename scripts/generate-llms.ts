/**
 * Generate public/llms.txt for AI discoverability.
 * Runs as prebuild on Vercel.
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const config = {
  name: "Agent DNA",
  tagline: "Onchain behavioral fingerprints and token safety for OKX.AI agents",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://agentdnas.vercel.app",
  description:
    "Agent DNA is an Agent Service Provider (A2MCP) on OKX.AI. It offers paid Agent Scan and Token Scan endpoints on X Layer so agents can vet counterparties and tokens before committing capital.",
  routes: [
    {
      path: "/",
      purpose:
        "Landing page and live playground for humans and judges. Explains the product and shows radar DNA output.",
    },
    {
      path: "/api/health",
      purpose: "Health check. Returns service name, version, demoMode flag, status.",
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
