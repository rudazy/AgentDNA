/**
 * Failure handling for the x402 seller wiring.
 *
 * Kept free of SDK and Next imports so the failure paths are unit testable and
 * so nothing here can itself throw at module evaluation. The wiring it guards
 * runs at import time in route modules, where an uncaught throw becomes an
 * empty 500 that carries no diagnosis at all.
 */

import type { NextRequest, NextResponse } from "next/server";

export type AppRouteHandler = (request: NextRequest) => Promise<NextResponse>;

/** Which piece of the seller wiring failed. Reported verbatim to the caller. */
export type WiringStage =
  | "credentials"
  | "facilitator"
  | "route-config"
  | "middleware"
  | "request";

export interface WiringFailure {
  stage: WiringStage;
  detail: string;
}

const STAGE_DESCRIPTIONS: Readonly<Record<WiringStage, string>> = {
  credentials: "OKX SA credential validation",
  facilitator: "x402 facilitator construction",
  "route-config": "x402 route config construction",
  middleware: "x402 middleware construction",
  request: "x402 middleware execution on this request",
};

const SECRET_ENV_KEYS = [
  "OKX_API_KEY",
  "OKX_SECRET_KEY",
  "OKX_PASSPHRASE",
  "OKXOS_API_KEY",
  "OKXOS_SECRET_KEY",
  "OKXOS_PASSPHRASE",
  "OKLINK_API_KEY",
  "OKLINK_SECRET_KEY",
  "OKLINK_PASSPHRASE",
  "FOREMAN_FLOAT_PRIVATE_KEY",
  "BUYER_PRIVATE_KEY",
] as const;

/**
 * Remove any configured secret value from an outbound message. SDK errors can
 * quote whatever they were handed, so scrub before anything leaves the process.
 * Length is capped so a stack-like message cannot be exfiltrated through it.
 */
export function redactSecrets(
  text: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const secrets = SECRET_ENV_KEYS.map((key) => env[key]?.trim() ?? "").filter(
    (value) => value.length >= 8,
  );
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out.length > 300 ? `${out.slice(0, 297)}...` : out;
}

const MAX_CAUSE_DEPTH = 4;

/**
 * Flatten an error and its cause chain.
 *
 * The SDK reports facilitator problems as a generic top-level message and hangs
 * the real reason (an HTTP status, a DNS failure) off `cause`. Reporting only
 * `message` throws away the only part that identifies the fault, so walk the
 * chain. Absence of a cause is itself diagnostic: it means the facilitator
 * answered successfully and simply returned nothing usable.
 */
export function errorChain(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current !== undefined && current !== null && depth < MAX_CAUSE_DEPTH; depth++) {
    parts.push(current instanceof Error ? current.message : String(current));
    current =
      current instanceof Error
        ? (current as Error & { cause?: unknown }).cause
        : undefined;
  }
  return parts.join(" <- caused by: ");
}

export function describeWiringFailure(
  stage: WiringStage,
  err: unknown,
  env?: Record<string, string | undefined>,
): WiringFailure {
  return { stage, detail: redactSecrets(errorChain(err), env) };
}

/**
 * Body for a wiring failure. 503, not 402: the caller cannot fix this by
 * paying, and advertising a price while settlement is broken risks a client
 * paying into a seller that cannot verify or settle the payment.
 */
export function wiringErrorBody(failure: WiringFailure): {
  status: number;
  body: Record<string, unknown>;
} {
  return {
    status: 503,
    body: {
      error: "Payment wiring unavailable",
      code: "X402_WIRING_FAILED",
      stage: failure.stage,
      details: `${STAGE_DESCRIPTIONS[failure.stage]} failed: ${failure.detail}`,
    },
  };
}

export type GateResult =
  | { ok: true; handler: AppRouteHandler }
  | { ok: false; failure: WiringFailure };

/**
 * Build the paid gate, converting any throw into a typed failure rather than
 * letting it escape at module evaluation time. Dependency injected so every
 * failure branch is testable without the SDK.
 */
export function resolveGate(steps: {
  resourceServer: () => unknown;
  routeConfig: () => unknown;
  wrap: (server: unknown, config: unknown) => AppRouteHandler;
}): GateResult {
  let server: unknown;
  try {
    server = steps.resourceServer();
  } catch (err) {
    return { ok: false, failure: describeWiringFailure("facilitator", err) };
  }

  let config: unknown;
  try {
    config = steps.routeConfig();
  } catch (err) {
    return { ok: false, failure: describeWiringFailure("route-config", err) };
  }

  try {
    return { ok: true, handler: steps.wrap(server, config) };
  } catch (err) {
    return { ok: false, failure: describeWiringFailure("middleware", err) };
  }
}
