import { NextRequest, NextResponse } from "next/server";
import { validateAddress } from "@/lib/address";
import { isSameOriginRequest } from "@/lib/origin";
import {
  checkWindowRateLimit,
  clientIpFromHeaders,
  PLAYGROUND_MAX_PER_HOUR,
  PLAYGROUND_WINDOW_MS,
} from "@/lib/ratelimit";
import {
  ForemanError,
  forcedDryRunDeps,
  runDispatch,
  type DispatchContext,
} from "@/lib/foreman";
import {
  runAgentScan,
  runTokenScan,
  ScanServiceError,
  type ScanKind,
} from "@/lib/scan-service";
import type { ErrorBody } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Free internal playground endpoint. No x402.
 * Abuse controls: same-origin + 10 requests/hour per IP.
 * SERVERLESS CAVEAT: rate limit is per Vercel isolate only.
 */

function errorJson(status: number, body: ErrorBody, extraHeaders?: HeadersInit) {
  return NextResponse.json(body, { status, headers: extraHeaders });
}

function parsePlaygroundContext(raw: unknown): DispatchContext {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  return {
    addresses: Array.isArray(r.addresses)
      ? r.addresses.filter((a): a is string => typeof a === "string")
      : undefined,
    tokenAddress: typeof r.tokenAddress === "string" ? r.tokenAddress : undefined,
    agentAddress: typeof r.agentAddress === "string" ? r.agentAddress : undefined,
    contractAddress:
      typeof r.contractAddress === "string" ? r.contractAddress : undefined,
    marketId: typeof r.marketId === "string" ? r.marketId : undefined,
    chain: typeof r.chain === "string" ? r.chain : undefined,
  };
}

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return errorJson(403, {
      error: "Forbidden",
      code: "BAD_REQUEST",
      details:
        "Playground scans are limited to same-origin browser requests from this site.",
    });
  }

  const ip = clientIpFromHeaders(req.headers);
  const rl = checkWindowRateLimit(
    `playground:${ip}`,
    PLAYGROUND_MAX_PER_HOUR,
    PLAYGROUND_WINDOW_MS,
  );
  if (!rl.allowed) {
    return errorJson(
      429,
      {
        error: "Playground rate limit exceeded",
        code: "RATE_LIMITED",
        details: `Free preview is limited to ${PLAYGROUND_MAX_PER_HOUR} scans per hour per IP. Agents pay per call via x402 on /api/scan/agent and /api/scan/token.`,
      },
      { "Retry-After": String(rl.retryAfterSec) },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson(400, {
      error: "Invalid JSON body",
      code: "BAD_REQUEST",
      details:
        'Expected JSON object: { "address": "0x...", "scan": "agent" | "token" }',
    });
  }

  if (typeof body !== "object" || body === null) {
    return errorJson(400, {
      error: "Invalid JSON body",
      code: "BAD_REQUEST",
      details:
        'Expected JSON object: { "address": "0x...", "scan": "agent" | "token" }',
    });
  }

  const record = body as {
    address?: unknown;
    scan?: unknown;
    goal?: unknown;
    budget?: unknown;
    context?: unknown;
  };
  const scanRaw = record.scan;
  if (scanRaw !== "agent" && scanRaw !== "token" && scanRaw !== "dispatch") {
    return errorJson(400, {
      error: "Invalid scan type",
      code: "BAD_REQUEST",
      details: 'scan must be "agent", "token", or "dispatch"',
    });
  }

  if (scanRaw === "dispatch") {
    // Free preview always runs the dispatcher in forced dry run: outbound
    // hires are mocked server-side so the playground can never spend real
    // float, regardless of FOREMAN_DRY_RUN.
    try {
      const result = await runDispatch(
        {
          goal: typeof record.goal === "string" ? record.goal : "",
          budget: typeof record.budget === "number" ? record.budget : undefined,
          context: parsePlaygroundContext(record.context),
        },
        forcedDryRunDeps(),
      );
      return NextResponse.json(
        { ...result, playground: true as const },
        {
          headers: {
            "Cache-Control": "no-store",
            "X-RateLimit-Remaining": String(rl.remaining),
          },
        },
      );
    } catch (err) {
      if (err instanceof ForemanError) {
        return errorJson(err.status, {
          error: err.message,
          code: "BAD_REQUEST",
          details: err.details ? err.details.join(" ") : undefined,
        });
      }
      console.error("[playground-dispatch]", err);
      return errorJson(500, {
        error: "Internal error",
        code: "INTERNAL",
        details: "Playground dispatch failed unexpectedly",
      });
    }
  }

  const scan = scanRaw as ScanKind;

  const validated = validateAddress(record.address);
  if (!validated.ok) {
    return errorJson(400, {
      error: "Invalid address",
      code: "BAD_REQUEST",
      details: validated.message,
    });
  }

  try {
    const result =
      scan === "agent"
        ? await runAgentScan(validated.address)
        : await runTokenScan(validated.address);

    return NextResponse.json(
      {
        ...result,
        playground: true as const,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-RateLimit-Remaining": String(rl.remaining),
        },
      },
    );
  } catch (err) {
    if (err instanceof ScanServiceError) {
      return errorJson(err.status, {
        error: err.message,
        code:
          err.code === "CONFIG"
            ? "UPSTREAM"
            : err.code === "NOT_FOUND"
              ? "NOT_FOUND"
              : err.code === "RATE_LIMITED"
                ? "RATE_LIMITED"
                : err.code === "UPSTREAM"
                  ? "UPSTREAM"
                  : "INTERNAL",
        details: err.details,
      });
    }
    console.error("[playground-scan]", err);
    return errorJson(500, {
      error: "Internal error",
      code: "INTERNAL",
      details: "Playground scan failed unexpectedly",
    });
  }
}
