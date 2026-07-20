/**
 * Real, settled dispatches shown in the Proven Onchain section.
 *
 * Every value here was read back from X Layer, not copied from a response body.
 * Each transaction was confirmed with eth_getTransactionReceipt on
 * https://rpc.xlayer.tech: status success, USDT0 contract
 * 0x779Ded...3736, and the decoded Transfer log matching the amount, sender,
 * and recipient recorded below.
 *
 * Rules for editing this file:
 *   - Never add an entry that has not been verified on chain the same way.
 *   - Omit any field that is not known. Do not approximate or infer one.
 *
 * Kept separate from the view so a live feed can replace the source later
 * without touching the rendering.
 */

import { X_LAYER_EXPLORER_TX_BASE } from "./constants";

export interface ProvenHire {
  subcontractor: string;
  service: string;
  /** paid means settled on chain; declined means Foreman refused before paying. */
  outcome: "paid" | "declined";
  amountUsdt0?: string;
  txHash?: string;
  trustVerdict?: string;
  payee?: string;
  note?: string;
}

export interface ProvenDispatch {
  id: string;
  goalSummary: string;
  /** ISO 8601, taken from the block timestamp of the inbound settlement. */
  settledAtIso: string;
  inbound: {
    amountUsdt0: string;
    txHash: string;
    payer: string;
  };
  hires: readonly ProvenHire[];
}

export const PROVEN_DISPATCHES: readonly ProvenDispatch[] = [
  {
    id: "dispatch-2026-07-20",
    goalSummary: "Token safety check plus CertiK security audit",
    settledAtIso: "2026-07-20T10:56:47.000Z",
    inbound: {
      amountUsdt0: "0.50",
      txHash:
        "0x47273b5ef523c65e193c13f2822f5342b6402379a34ca14d176b43f5ccf2d654",
      payer: "0xab23ab7b1af66d06443bb06e899de4e17d86761c",
    },
    hires: [
      {
        subcontractor: "CertiK",
        service: "Security audit",
        outcome: "paid",
        amountUsdt0: "0.001",
        txHash:
          "0x44339ea4e76b551e2f88c2cc2951a0b391680dab9c81385d4016c199fa276185",
        trustVerdict: "Trust check passed, grade C",
        payee: "0x0df8e47790d2c1ec3e8dc31abc1ea8720519042f",
      },
      {
        subcontractor: "ChainSentry",
        service: "Token safety",
        outcome: "declined",
        note: "Advertised an incompatible x402 protocol version, so Foreman declined the hire and paid nothing.",
      },
    ],
  },
];

/** Canonical explorer link for one transaction. */
export function explorerTxUrl(txHash: string): string {
  return `${X_LAYER_EXPLORER_TX_BASE}/${txHash}`;
}

/** Display form for a 32 byte hash, for example 0x4727...d654. */
export function truncateHash(txHash: string): string {
  return txHash.length <= 12
    ? txHash
    : `${txHash.slice(0, 6)}...${txHash.slice(-4)}`;
}

/**
 * Deterministic UTC label, for example "2026-07-20 10:56 UTC". Built by slicing
 * the ISO string rather than using toLocaleString, which would render
 * differently on the server and the client and trip hydration.
 */
export function formatSettledAt(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Total USDT0 actually paid to subcontractors across all shown dispatches. */
export function totalPaidDownstream(
  dispatches: readonly ProvenDispatch[] = PROVEN_DISPATCHES,
): string {
  const micro = dispatches
    .flatMap((d) => d.hires)
    .filter((h) => h.outcome === "paid" && h.amountUsdt0)
    .reduce((sum, h) => sum + Math.round(Number(h.amountUsdt0) * 1e6), 0);
  return (micro / 1e6).toFixed(3);
}
