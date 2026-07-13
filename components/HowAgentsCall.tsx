"use client";

import { useState } from "react";
import { PRICES } from "@/lib/constants";
import { CornerOrnaments, SectionLabel } from "./Ornament";

const AGENT_EXAMPLE = `curl -X POST https://YOUR_DOMAIN/api/scan/agent \\
  -H "Content-Type: application/json" \\
  -H "PAYMENT-SIGNATURE: <x402-proof>" \\
  -d '{"address":"0x..."}'`;

const TOKEN_EXAMPLE = `curl -X POST https://YOUR_DOMAIN/api/scan/token \\
  -H "Content-Type: application/json" \\
  -H "PAYMENT-SIGNATURE: <x402-proof>" \\
  -d '{"address":"0x..."}'`;

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      className="min-h-10 shrink-0 rounded-lg border border-lime/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted transition-all hover:border-lime/60 hover:text-lime hover:shadow-[0_0_16px_rgba(200,241,53,0.16)]"
      aria-label={`Copy ${label}`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function HowAgentsCall() {
  return (
    <section
      id="how"
      className="w-full pb-12 sm:pb-20 md:pb-28"
      aria-labelledby="how-heading"
    >
      <div className="mx-auto max-w-content px-4 sm:px-5">
        <div className="relative glass-panel overflow-hidden px-4 py-7 sm:px-8 sm:py-10 md:px-10 md:py-12">
          <CornerOrnaments />
          <div
            aria-hidden
            className="pointer-events-none absolute -left-10 bottom-0 h-40 w-40 bg-lime/10 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 h-36 w-36 bg-gold/10 blur-3xl"
          />

          <div className="relative">
            <SectionLabel>How agents call this</SectionLabel>
            <h2
              id="how-heading"
              className="mt-3 max-w-2xl font-mono text-lg text-ink sm:mt-4 sm:text-xl md:text-2xl"
            >
              A2MCP pay-per-call on X Layer via x402.
            </h2>
            <p className="mt-2 max-w-2xl font-mono text-sm text-muted">
              Settlement in USDT0. Unpaid requests receive HTTP 402 with accept
              details.
            </p>

            <div className="mt-7 grid gap-4 sm:mt-9 sm:gap-6 md:grid-cols-2">
              <div className="relative overflow-hidden rounded-2xl border border-lime/25 bg-black/35 p-4 sm:p-5">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-lime/70 to-transparent"
                />
                <div className="flex items-start justify-between gap-3">
                  <p className="break-all font-mono text-[11px] uppercase tracking-[0.14em] text-lime">
                    POST /api/scan/agent
                  </p>
                  <CopyButton text={AGENT_EXAMPLE} label="agent example" />
                </div>
                <p className="gold-number mt-3 font-mono text-base sm:text-lg">
                  {PRICES.agent} USDT0 per call
                </p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted sm:mt-4 sm:text-xs">
                  {AGENT_EXAMPLE}
                </pre>
              </div>

              <div className="relative overflow-hidden rounded-2xl border border-gold/25 bg-black/35 p-4 sm:p-5">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent"
                />
                <div className="flex items-start justify-between gap-3">
                  <p className="break-all font-mono text-[11px] uppercase tracking-[0.14em] text-lime">
                    POST /api/scan/token
                  </p>
                  <CopyButton text={TOKEN_EXAMPLE} label="token example" />
                </div>
                <p className="gold-number mt-3 font-mono text-base sm:text-lg">
                  {PRICES.token} USDT0 per call
                </p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted sm:mt-4 sm:text-xs">
                  {TOKEN_EXAMPLE}
                </pre>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-lime/15 bg-black/40 p-4 font-mono text-sm sm:mt-6 sm:p-5">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                Response shape (agent)
              </p>
              <pre className="mt-3 overflow-x-auto text-[11px] leading-relaxed text-ink/80 sm:text-xs">{`{
  "service": "agent-dna",
  "scan": "agent",
  "address": "0x...",
  "grade": "B+",
  "traits": { "reliability": 82, "consistency": 74, "longevity": 61,
              "riskAppetite": 38, "activity": 70, "counterpartyDiversity": 66 },
  "deliveryProbability": 78,
  "deliveryProbabilityLabel": "heuristic estimate",
  "confidence": 71,
  "explanation": "...",
  "scannedAt": "ISO timestamp",
  "version": "1.0.0"
}`}</pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
