"use client";

import { useCallback, useState } from "react";
import { DnaRadar } from "./DnaRadar";
import { CornerOrnaments, SectionLabel } from "./Ornament";
import type { AgentScanResponse, TokenScanResponse } from "@/lib/types";

type ScanMode = "agent" | "token";

export function Playground() {
  const [mode, setMode] = useState<ScanMode>("agent");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentResult, setAgentResult] = useState<AgentScanResponse | null>(
    null,
  );
  const [tokenResult, setTokenResult] = useState<TokenScanResponse | null>(
    null,
  );

  const runScan = useCallback(async () => {
    setError(null);
    setLoading(true);
    setAgentResult(null);
    setTokenResult(null);

    try {
      const res = await fetch("/api/playground/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.trim(), scan: mode }),
      });

      const data: unknown = await res.json();

      if (!res.ok) {
        const errObj = data as {
          error?: string;
          details?: string;
          code?: string;
        };
        setError(
          [errObj.error, errObj.details].filter(Boolean).join(". ") ||
            `Request failed (${res.status})`,
        );
        return;
      }

      if (mode === "agent") {
        setAgentResult(data as AgentScanResponse);
      } else {
        setTokenResult(data as TokenScanResponse);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [address, mode]);

  return (
    <section
      id="playground"
      className="w-full py-8 sm:py-14 md:py-20"
      aria-labelledby="playground-heading"
    >
      <div className="mx-auto max-w-content px-4 sm:px-5">
        <div className="relative glass-panel overflow-hidden px-4 py-7 sm:px-8 sm:py-10 md:px-10 md:py-12">
          <CornerOrnaments />
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 h-36 w-36 bg-lime/10 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-0 h-32 w-32 bg-gold/10 blur-3xl"
          />

          <div className="relative">
            <SectionLabel>Live playground</SectionLabel>
            <h2
              id="playground-heading"
              className="mt-3 max-w-2xl font-mono text-lg text-ink sm:mt-4 sm:text-xl md:text-2xl"
            >
              Paste an X Layer address. Toggle Agent Scan or Token Scan.
            </h2>
            <p className="mt-2 max-w-2xl font-mono text-sm text-muted">
              Free preview, rate limited (10/hour). Agents pay per call via
              x402 on the public scan endpoints.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:mt-9 sm:gap-4">
              <div className="w-full">
                <label
                  htmlFor="scan-address"
                  className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-muted"
                >
                  Address
                </label>
                <input
                  id="scan-address"
                  name="address"
                  type="text"
                  inputMode="text"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="0x..."
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="fancy-input"
                />
              </div>

              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-stretch">
                <div
                  className="mode-toggle sm:flex-1"
                  role="group"
                  aria-label="Scan type"
                >
                  <button
                    type="button"
                    onClick={() => setMode("agent")}
                    aria-pressed={mode === "agent"}
                  >
                    Agent Scan
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("token")}
                    aria-pressed={mode === "token"}
                  >
                    Token Scan
                  </button>
                </div>

                <button
                  type="button"
                  onClick={runScan}
                  disabled={loading || !address.trim()}
                  className="fancy-btn sm:w-auto sm:min-w-[10rem]"
                >
                  {loading ? "Scanning..." : "Run scan"}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 font-mono text-sm text-gold sm:mt-6"
              >
                {error}
              </div>
            )}

            {agentResult && (
              <div className="mt-8 grid gap-8 sm:mt-10 md:mt-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-10">
                <div className="relative rounded-2xl border border-lime/20 bg-black/35 p-2 sm:p-4">
                  <DnaRadar traits={agentResult.traits} />
                </div>
                <div className="min-w-0 space-y-5 font-mono sm:space-y-6">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                      Grade
                    </p>
                    <p className="gold-number mt-1 text-5xl font-medium tracking-wideish sm:text-6xl md:text-7xl">
                      {agentResult.grade}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                      Delivery probability
                    </p>
                    <p className="gold-number mt-1 text-3xl sm:text-4xl md:text-5xl">
                      {agentResult.deliveryProbability}
                      <span className="ml-2 text-sm text-muted sm:text-base">
                        /100 heuristic estimate
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                      Confidence
                    </p>
                    <p className="mt-1 text-lg text-lime sm:text-xl">
                      {agentResult.confidence}/100
                    </p>
                  </div>
                  <p className="text-sm leading-relaxed text-muted">
                    {agentResult.explanation}
                  </p>
                  <ul className="grid grid-cols-1 gap-1 text-xs text-muted xs:grid-cols-2">
                    {Object.entries(agentResult.traits).map(([k, v]) => (
                      <li
                        key={k}
                        className="flex justify-between gap-2 border-b border-lime/15 py-2"
                      >
                        <span className="truncate">{k}</span>
                        <span className="text-lime">{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {tokenResult && (
              <div className="mt-8 space-y-5 font-mono sm:mt-10 sm:space-y-6">
                <div className="grid grid-cols-1 gap-5 xs:grid-cols-3 xs:gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                      Safety score
                    </p>
                    <p className="gold-number mt-1 text-5xl sm:text-6xl">
                      {tokenResult.score}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                      Risk level
                    </p>
                    <p
                      className={`mt-1 text-xl sm:text-2xl ${
                        tokenResult.riskLevel === "LOW"
                          ? "text-lime"
                          : tokenResult.riskLevel === "MEDIUM"
                            ? "text-gold"
                            : "text-ink"
                      }`}
                    >
                      {tokenResult.riskLevel}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                      Confidence
                    </p>
                    <p className="mt-1 text-lg text-lime sm:text-xl">
                      {tokenResult.confidence}/100
                    </p>
                  </div>
                </div>
                {tokenResult.flags.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                      Flags
                    </p>
                    <ul className="mt-2 space-y-2 text-sm text-gold sm:mt-3">
                      {tokenResult.flags.map((f) => (
                        <li
                          key={f}
                          className="rounded-lg border-l-2 border-gold/70 bg-gold/10 py-2.5 pl-3"
                        >
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="max-w-2xl text-sm leading-relaxed text-muted">
                  {tokenResult.explanation}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
