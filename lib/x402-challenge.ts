/**
 * Pure x402 challenge helpers (no Next.js / SDK imports). Safe for unit tests.
 */

import { PRICES, USDT0_ADDRESS, X_LAYER_NETWORK } from "./constants";

export type ScanKind = "agent" | "token" | "dispatch";

/**
 * Unpaid 402 JSON body shape for Agent DNA paid routes.
 * SDK also emits protocol challenge headers; this body is used for unpaidResponseBody
 * and for documentation / unit tests.
 */
export function buildUnpaidChallengeBody(
  scan: ScanKind,
  payTo: string | null,
): {
  error: string;
  code: "PAYMENT_REQUIRED";
  details: string;
  x402Version: number;
  accepts: Array<{
    scheme: "exact";
    network: typeof X_LAYER_NETWORK;
    payTo: string | null;
    price: string;
    asset: typeof USDT0_ADDRESS;
    maxTimeoutSeconds: number;
  }>;
  headersHint: string[];
} {
  const price = priceForScan(scan);
  const label = scan === "dispatch" ? "dispatch job" : `${scan} scan`;
  return {
    error: "Payment required",
    code: "PAYMENT_REQUIRED",
    details: `This ${label} costs ${price} USDT0 on X Layer (x402 exact scheme). Sign payment and retry with PAYMENT-SIGNATURE or X-PAYMENT.`,
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: X_LAYER_NETWORK,
        payTo,
        price,
        asset: USDT0_ADDRESS,
        maxTimeoutSeconds: 300,
      },
    ],
    headersHint: [
      "PAYMENT-SIGNATURE",
      "X-PAYMENT",
      "Authorization: Payment <payload>",
    ],
  };
}

export function priceForScan(scan: ScanKind): string {
  if (scan === "agent") return PRICES.agent;
  if (scan === "token") return PRICES.token;
  return PRICES.dispatch;
}
