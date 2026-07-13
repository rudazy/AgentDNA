/**
 * Payment helpers and DEMO_MODE flags.
 * Live settlement is in lib/x402-server.ts via withX402.
 */

export {
  buildUnpaidChallengeBody,
  getPayToAddress,
  hasX402Credentials,
  isDemoMode,
  PRICES,
  protectWithX402,
  USDT0_ADDRESS,
  X_LAYER_NETWORK,
} from "./x402-server";

/** @deprecated Prefer isDemoMode from x402-server. Kept for health route. */
export function isDemoModeEnabled(): boolean {
  const v = process.env.DEMO_MODE?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}
