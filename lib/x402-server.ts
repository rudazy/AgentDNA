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
  describeWiringFailure,
  getFacilitatorBaseUrl,
  resolveGate,
  wiringErrorBody,
  type AppRouteHandler,
  type WiringFailure,
} from "./x402-wiring";
import {
  buildUnpaidChallengeBody,
  priceForScan,
  type ScanKind,
} from "./x402-challenge";

export { PRICES, USDT0_ADDRESS, X_LAYER_NETWORK };
export { buildUnpaidChallengeBody, type ScanKind } from "./x402-challenge";
export {
  redactSecrets,
  resolveGate,
  wiringErrorBody,
  type WiringFailure,
  type WiringStage,
} from "./x402-wiring";

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
        : scan === "token"
          ? "Agent DNA Token Scan on X Layer"
          : "Foreman Dispatch on X Layer",
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

  // Always a concrete string. Passing undefined here overwrites the SDK's own
  // default via object spread and produces "undefined/api/v6/pay/x402/supported",
  // which fails every request and surfaces only as "no supported payment kinds".
  const facilitatorClient = new OKXFacilitatorClient({
    apiKey,
    secretKey,
    passphrase,
    baseUrl: getFacilitatorBaseUrl(),
    syncSettle: true,
  });

  resourceServerSingleton = new x402ResourceServer(facilitatorClient).register(
    X_LAYER_NETWORK,
    new ExactEvmScheme(),
  );

  return resourceServerSingleton;
}

async function wiringErrorResponse(
  failure: WiringFailure,
): Promise<NextResponse> {
  const { NextResponse: NR } = await import("next/server");
  const { status, body } = wiringErrorBody(failure);
  return NR.json(body, { status });
}

function wiringFailureHandler(failure: WiringFailure): AppRouteHandler {
  // Logged once per cold start rather than per request, with the same redaction.
  console.error(
    `[x402] wiring failed at ${failure.stage}: ${failure.detail}`,
  );
  return async () => wiringErrorResponse(failure);
}

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
    return wiringFailureHandler({
      stage: "credentials",
      detail:
        "DEMO_MODE is off but OKX SA credentials or X402_PAYTO_ADDRESS are missing. " +
        "Configure OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE, and X402_PAYTO_ADDRESS.",
    });
  }

  const gate = resolveGate({
    resourceServer: () => getResourceServer(),
    routeConfig: () => buildRouteConfig(scan),
    // syncFacilitatorOnStart true: initialize on first request in serverless.
    wrap: (server, config) =>
      withX402(
        handler,
        config as RouteConfig,
        server as x402ResourceServer,
        undefined,
        undefined,
        true,
      ),
  });

  if (!gate.ok) return wiringFailureHandler(gate.failure);

  // The facilitator sync is deferred to the first request, so a wiring fault can
  // still surface here rather than above. Catching it keeps the failure
  // diagnosable instead of an empty 500, and never runs the paid handler.
  const gated = gate.handler;
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      return await gated(request);
    } catch (err) {
      const failure = describeWiringFailure("request", err);
      console.error(`[x402] wiring failed at request: ${failure.detail}`);
      return wiringErrorResponse(failure);
    }
  };
}
