"use client";

import { useCallback, useState } from "react";
import { DnaRadar } from "./DnaRadar";
import { CornerOrnaments, SectionLabel } from "./Ornament";
import type { DispatchResponse } from "@/lib/foreman";
import type { AgentScanResponse, TokenScanResponse } from "@/lib/types";

type ScanMode = "agent" | "token" | "dispatch";

const XLAYER_TX_EXPLORER = "https://www.oklink.com/xlayer/tx/";

export function Playground() {
  const [mode, setMode] = useState<ScanMode>("agent");
  const [address, setAddress] = useState("");
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentResult, setAgentResult] = useState<AgentScanResponse | null>(
    null,
  );
  const [tokenResult, setTokenResult] = useState<TokenScanResponse | null>(
    null,
  );
  const [dispatchResult, setDispatchResult] = useState<DispatchResponse | null>(
    null,
  );

  const canRun =
    mode === "dispatch" ? goal.trim() !== "" : address.trim() !== "";

  const runScan = useCallback(async () => {
    setError(null);
    setLoading(true);
    setAgentResult(null);
    setTokenResult(null);
    setDispatchResult(null);

    try {
      const payload: Record<string, unknown> =
        mode === "dispatch"
          ? {
              scan: "dispatch",
              goal: goal.trim(),
              ...(budget.trim() !== "" && Number.isFinite(Number(budget))
                ? { budget: Number(budget) }
                : {}),
            }
          : { address: address.trim(), scan: mode };

      const res = await fetch("/api/playground/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
      } else if (mode === "token") {
        setTokenResult(data as TokenScanResponse);
      } else {
        setDispatchResult(data as DispatchResponse);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [address, budget, goal, mode]);

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
              {mode === "dispatch"
                ? "Give Foreman a goal and a budget. It plans the hires."
                : "Paste an X Layer address. Toggle Agent Scan or Token Scan."}
            </h2>
            <p className="mt-2 max-w-2xl font-mono text-sm text-muted">
              {mode === "dispatch"
                ? "Free preview runs in dry run: the plan, routing, and receipts are real, but no marketplace ASP is called and nothing is paid. Agents pay 0.50 USDT0 per job via x402 on /api/dispatch."
                : "Free preview, rate limited (10/hour). Agents pay per call via x402 on the public scan endpoints."}
            </p>

            {/* Shown in both modes: the default tab is a scan, so a dispatch
                only note would be invisible to most visitors. */}
            <p className="mt-2 max-w-2xl font-mono text-sm leading-relaxed text-muted">
              {mode === "dispatch"
                ? "Dry run here means visitors cannot spend Foreman's float."
                : "This preview is free, so nothing is charged and no float is spent."}{" "}
              For real hires that Foreman paid and settled on X Layer, see{" "}
              <a
                href="#proven"
                className="touch-link text-lime underline decoration-lime/40 underline-offset-4 hover:decoration-lime"
              >
                Proven onchain
              </a>{" "}
              below, executed through the paid endpoint with verifiable
              transaction hashes.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:mt-9 sm:gap-4">
              {mode === "dispatch" ? (
                <>
                  <div className="w-full">
                    <label
                      htmlFor="dispatch-goal"
                      className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-muted"
                    >
                      Goal
                    </label>
                    <textarea
                      id="dispatch-goal"
                      name="goal"
                      rows={3}
                      spellCheck={false}
                      placeholder="Example: check the polymarket odds on the fed cutting rates, and run due diligence on agent 0x..."
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                      className="fancy-input resize-y"
                    />
                  </div>
                  <div className="w-full sm:max-w-[16rem]">
                    <label
                      htmlFor="dispatch-budget"
                      className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-muted"
                    >
                      Budget (USDT0, optional)
                    </label>
                    <input
                      id="dispatch-budget"
                      name="budget"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.35"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      className="fancy-input"
                    />
                  </div>
                </>
              ) : (
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
              )}

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
                  <button
                    type="button"
                    onClick={() => setMode("dispatch")}
                    aria-pressed={mode === "dispatch"}
                  >
                    Dispatch
                  </button>
                </div>

                <button
                  type="button"
                  onClick={runScan}
                  disabled={loading || !canRun}
                  className="fancy-btn sm:w-auto sm:min-w-[10rem]"
                >
                  {loading
                    ? mode === "dispatch"
                      ? "Dispatching..."
                      : "Scanning..."
                    : mode === "dispatch"
                      ? "Run dispatch"
                      : "Run scan"}
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
                    {agentResult.grade === "UNRATED" ? (
                      <p className="mt-1 text-2xl font-medium tracking-[0.18em] text-muted sm:text-3xl md:text-4xl">
                        UNRATED
                      </p>
                    ) : (
                      <p className="gold-number mt-1 text-5xl font-medium tracking-wideish sm:text-6xl md:text-7xl">
                        {agentResult.grade}
                      </p>
                    )}
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

            {dispatchResult && (
              <div className="mt-8 space-y-6 font-mono sm:mt-10">
                <div className="grid grid-cols-1 gap-5 xs:grid-cols-3 xs:gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                      Total paid downstream
                    </p>
                    <p className="gold-number mt-1 text-4xl sm:text-5xl">
                      {dispatchResult.totalPaid}
                      <span className="ml-2 text-sm text-muted">USDT0</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                      Subtasks
                    </p>
                    <p className="mt-1 text-3xl text-lime sm:text-4xl">
                      {dispatchResult.results.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                      Mode
                    </p>
                    <p className="mt-1 text-lg text-lime sm:text-xl">
                      {dispatchResult.dryRun ? "DRY RUN" : "LIVE"}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                    Plan
                  </p>
                  <ul className="mt-2 space-y-2 text-sm sm:mt-3">
                    {dispatchResult.plan.subtasks.map((s, i) => (
                      <li
                        key={`${s.kind}-${i}`}
                        className="rounded-lg border-l-2 border-lime/50 bg-black/25 py-2.5 pl-3 pr-3"
                      >
                        <span className="text-ink">{s.title}</span>
                        <span className="ml-2 text-muted">
                          via {s.provider}
                          {s.priceUsdt0 !== "0" ? (
                            <span className="text-gold"> at {s.priceUsdt0} USDT0</span>
                          ) : null}
                        </span>
                        <p className="mt-1 text-xs text-muted">{s.rationale}</p>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                    Results
                  </p>
                  <ul className="mt-2 space-y-2 text-sm sm:mt-3">
                    {dispatchResult.results.map((r, i) => (
                      <li
                        key={`${r.kind}-result-${i}`}
                        className={`rounded-lg border-l-2 py-2.5 pl-3 pr-3 ${
                          r.status === "ok"
                            ? "border-lime/70 bg-lime/5"
                            : "border-gold/70 bg-gold/10"
                        }`}
                      >
                        <span
                          className={`mr-2 text-[11px] uppercase tracking-[0.18em] ${
                            r.status === "ok" ? "text-lime" : "text-gold"
                          }`}
                        >
                          {r.status}
                        </span>
                        <span className="text-ink">{r.title}</span>
                        <p className="mt-1 text-xs leading-relaxed text-muted">
                          {r.summary}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>

                {dispatchResult.receipts.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                      Receipts
                    </p>
                    <div className="mt-2 overflow-x-auto sm:mt-3">
                      <table className="w-full min-w-[36rem] border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b border-lime/20 text-[10px] uppercase tracking-[0.18em] text-muted">
                            <th className="py-2 pr-4 font-normal">Subcontractor</th>
                            <th className="py-2 pr-4 font-normal">Amount</th>
                            <th className="py-2 pr-4 font-normal">Settlement</th>
                            <th className="py-2 pr-4 font-normal">Trust check</th>
                            <th className="py-2 font-normal">Tx</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dispatchResult.receipts.map((rc, i) => (
                            <tr
                              key={`receipt-${i}`}
                              className="border-b border-lime/10 align-top"
                            >
                              <td className="py-2.5 pr-4 text-ink">
                                {rc.subcontractor}
                              </td>
                              <td className="py-2.5 pr-4">
                                <span className="gold-number text-sm">
                                  {rc.amountUsdt0}
                                </span>
                                <span className="ml-1 text-muted">USDT0</span>
                              </td>
                              <td className="py-2.5 pr-4 text-muted">
                                {rc.settlementStatus}
                              </td>
                              <td className="py-2.5 pr-4 text-muted">
                                {rc.trustCheck
                                  ? rc.trustCheck.grade
                                    ? `${rc.trustCheck.status} (${rc.trustCheck.grade})`
                                    : rc.trustCheck.status
                                  : "n/a"}
                              </td>
                              <td className="py-2.5">
                                {rc.txHash ? (
                                  <a
                                    href={`${XLAYER_TX_EXPLORER}${rc.txHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-lime underline decoration-lime/40 underline-offset-2 hover:decoration-lime"
                                  >
                                    {rc.txHash.slice(0, 10)}...
                                  </a>
                                ) : (
                                  <span className="text-muted">
                                    {rc.dryRun ? "dry run" : "pending"}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <p className="max-w-2xl text-sm leading-relaxed text-muted">
                  {dispatchResult.explanation}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
