/**
 * Proven Onchain: real settled dispatches with links to the X Layer explorer.
 *
 * Server rendered on purpose. The proof that Foreman executes real paid hires
 * should be in the initial HTML, readable without running any JavaScript and
 * visible to crawlers, not assembled client side.
 */

import {
  explorerTxUrl,
  formatSettledAt,
  PROVEN_DISPATCHES,
  totalPaidDownstream,
  truncateHash,
  type ProvenDispatch,
  type ProvenHire,
} from "@/lib/receipts";
import { CornerOrnaments, SectionLabel } from "./Ornament";

function TxLink({ txHash, label }: { txHash: string; label: string }) {
  return (
    <a
      href={explorerTxUrl(txHash)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} on the X Layer explorer, transaction ${txHash}`}
      className="touch-link font-mono text-lime underline decoration-lime/40 underline-offset-4 transition-colors hover:text-lime hover:decoration-lime"
    >
      {truncateHash(txHash)}
    </a>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
      {children}
    </p>
  );
}

function HireRow({ hire }: { hire: ProvenHire }) {
  const paid = hire.outcome === "paid";
  return (
    <li
      className={`rounded-lg border-l-2 py-3 pl-3 pr-3 ${
        paid ? "border-lime/70 bg-lime/5" : "border-gold/70 bg-gold/10"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={`text-[11px] uppercase tracking-[0.18em] ${
            paid ? "text-lime" : "text-gold"
          }`}
        >
          {paid ? "Paid" : "Declined"}
        </span>
        <span className="text-sm text-ink">{hire.subcontractor}</span>
        <span className="text-xs text-muted">{hire.service}</span>
        {hire.amountUsdt0 ? (
          <span className="font-mono text-sm text-gold">
            {hire.amountUsdt0} USDT0
          </span>
        ) : null}
      </div>

      {hire.trustVerdict ? (
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {hire.trustVerdict}
        </p>
      ) : null}

      {hire.note ? (
        <p className="mt-1 text-xs leading-relaxed text-muted">{hire.note}</p>
      ) : null}

      {hire.txHash ? (
        <p className="mt-2 font-mono text-xs text-muted">
          Settlement <TxLink txHash={hire.txHash} label={hire.subcontractor} />
        </p>
      ) : null}
    </li>
  );
}

function DispatchCard({ dispatch }: { dispatch: ProvenDispatch }) {
  return (
    <article className="rounded-xl border border-lime/15 bg-black/25 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-mono text-sm text-ink sm:text-base">
          {dispatch.goalSummary}
        </h3>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          {formatSettledAt(dispatch.settledAtIso)}
        </p>
      </div>

      <div className="mt-4">
        <FieldLabel>Inbound payment to Foreman</FieldLabel>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-sm">
          <span className="text-gold">{dispatch.inbound.amountUsdt0} USDT0</span>
          <TxLink txHash={dispatch.inbound.txHash} label="Inbound payment" />
          <span className="break-all text-xs text-muted">
            from {truncateHash(dispatch.inbound.payer)}
          </span>
        </div>
      </div>

      <div className="mt-4">
        <FieldLabel>Downstream hires</FieldLabel>
        <ul className="mt-2 space-y-2">
          {dispatch.hires.map((hire) => (
            <HireRow key={`${dispatch.id}-${hire.subcontractor}`} hire={hire} />
          ))}
        </ul>
      </div>
    </article>
  );
}

export function ProvenOnchain() {
  if (PROVEN_DISPATCHES.length === 0) return null;

  return (
    <section
      id="proven"
      className="w-full pb-12 sm:pb-20 md:pb-24"
      aria-labelledby="proven-heading"
    >
      <div className="mx-auto max-w-content px-4 sm:px-5">
        <div className="relative glass-panel overflow-hidden px-4 py-7 sm:px-8 sm:py-10 md:px-10 md:py-12">
          <CornerOrnaments />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 top-0 h-40 w-40 bg-gold/10 blur-3xl"
          />

          <div className="relative">
            <SectionLabel>Proven onchain</SectionLabel>
            <h2
              id="proven-heading"
              className="mt-3 max-w-2xl font-mono text-lg text-ink sm:mt-4 sm:text-xl md:text-2xl"
            >
              Real hires Foreman has executed and settled on X Layer.
            </h2>
            <p className="mt-2 max-w-2xl font-mono text-sm leading-relaxed text-muted">
              Every transaction below is verifiable on the X Layer explorer.
              Check them yourself without spending anything. Foreman paid{" "}
              <span className="text-gold">
                {totalPaidDownstream()} USDT0
              </span>{" "}
              to subcontractors from its own float; caller funds are never held
              or moved.
            </p>

            <div className="mt-6 space-y-4 sm:mt-8">
              {PROVEN_DISPATCHES.map((dispatch) => (
                <DispatchCard key={dispatch.id} dispatch={dispatch} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
