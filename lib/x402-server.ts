/**
 * Live x402 settlement wiring for paid scan routes.
 * Docs: https://github.com/okx/payments/blob/master/typescript/SELLER.md
 *
 * Next.js App Router: withX402(handler, routeConfig, resourceServer)
 * Network: eip155:196 (X Layer). Default asset: USDT0 (SDK auto).
 * Facilitator: OKX SA API via OKXFacilitatorClient (baseUrl default https://web3.okx.com).
 * Success: settlement proof attached as PAYMENT-RESPONSE header by the SDK.
 */

import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import {
  withX402,
  x402ResourceServer,
  type RouteConfig,
} from "@okxweb3/x402-next";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import type { NextRequest, NextResponse } from "next/server";
import { PRICES, USDT0_ADDRESS, X_LAYER_NETWORK } from "./constants";
import {
  buildUnpaidChallengeBody,
  priceForScan,
  type ScanKind,
} from "./x402-challenge";

export { PRICES, USDT0_ADDRESS, X_LAYER_NETWORK };
export { buildUnpaidChallengeBody, type ScanKind } from "./x402-challenge";

export function isDemoMode(): boolean {
  const v = process.env.DEMO_MODE?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Receiving wallet. Prefer X402_PAYTO_ADDRESS; PAY_TO accepted as alias (SELLER.md). */
export function getPayToAddress(): string {
  const addr =
    process.env.X402_PAYTO_ADDRESS?.trim() || process.env.PAY_TO?.trim() || "";
  return addr;
}

export function hasX402Credentials(): boolean {
  return Boolean(
    process.env.OKX_API_KEY?.trim() &&
      process.env.OKX_SECRET_KEY?.trim() &&
      process.env.OKX_PASSPHRASE?.trim() &&
      getPayToAddress(),
  );
}

export function buildRouteConfig(scan: ScanKind): RouteConfig {
  const price = priceForScan(scan);
  const payTo = getPayToAddress();
  if (!payTo) {
    throw new Error(
      "X402_PAYTO_ADDRESS (or PAY_TO) is required when DEMO_MODE is off",
    );
  }

  return {
    accepts: {
      scheme: "exact",
      network: X_LAYER_NETWORK,
      payTo,
      price,
      maxTimeoutSeconds: 300,
    },
    description:
      scan === "agent"
        ? "Agent DNA Agent Scan on X Layer"
        : "Agent DNA Token Scan on X Layer",
    mimeType: "application/json",
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: buildUnpaidChallengeBody(scan, payTo),
    }),
  };
}

let resourceServerSingleton: x402ResourceServer | null = null;

export function getResourceServer(): x402ResourceServer {
  if (resourceServerSingleton) return resourceServerSingleton;

  const apiKey = process.env.OKX_API_KEY?.trim();
  const secretKey = process.env.OKX_SECRET_KEY?.trim();
  const passphrase = process.env.OKX_PASSPHRASE?.trim();

  if (!apiKey || !secretKey || !passphrase) {
    throw new Error(
      "OKX_API_KEY, OKX_SECRET_KEY, and OKX_PASSPHRASE are required when DEMO_MODE is off",
    );
  }

  const facilitatorClient = new OKXFacilitatorClient({
    apiKey,
    secretKey,
    passphrase,
    baseUrl: process.env.OKX_FACILITATOR_BASE_URL?.trim() || undefined,
    syncSettle: true,
  });

  resourceServerSingleton = new x402ResourceServer(facilitatorClient).register(
    X_LAYER_NETWORK,
    new ExactEvmScheme(),
  );

  return resourceServerSingleton;
}

type AppRouteHandler = (request: NextRequest) => Promise<NextResponse>;

/**
 * Wrap a route handler with live x402 when DEMO_MODE is off.
 * DEMO_MODE=true: return handler unchanged (local only).
 * DEMO_MODE=false: full withX402 gate, no bypass.
 */
export function protectWithX402(
  handler: AppRouteHandler,
  scan: ScanKind,
): AppRouteHandler {
  if (isDemoMode()) {
    return handler;
  }

  if (!hasX402Credentials()) {
    return async () => {
      const { NextResponse: NR } = await import("next/server");
      return NR.json(
        {
          error: "Payment verification unavailable",
          code: "PAYMENT_REQUIRED",
          details:
            "DEMO_MODE is off but OKX SA credentials or X402_PAYTO_ADDRESS are missing. Configure OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE, and X402_PAYTO_ADDRESS.",
          accepts: buildUnpaidChallengeBody(scan, getPayToAddress() || null)
            .accepts,
        },
        { status: 402 },
      );
    };
  }

  const server = getResourceServer();
  const routeConfig = buildRouteConfig(scan);
  // syncFacilitatorOnStart true: initialize on first request in serverless.
  return withX402(handler, routeConfig, server, undefined, undefined, true);
}
