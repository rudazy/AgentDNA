import { NextRequest, NextResponse } from "next/server";
import { validateAddress } from "@/lib/address";
import { protectWithX402 } from "@/lib/x402-server";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/ratelimit";
import { runAgentScan, ScanServiceError } from "@/lib/scan-service";
import type { ErrorBody } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function errorJson(status: number, body: ErrorBody) {
  return NextResponse.json(body, { status });
}

async function handler(req: NextRequest) {
  const ip = clientIpFromHeaders(req.headers);
  const rl = checkRateLimit(`agent:${ip}`);
  if (!rl.allowed) {
    return errorJson(429, {
      error: "Rate limit exceeded",
      code: "RATE_LIMITED",
      details: "Too many requests from this IP. Retry shortly.",
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson(400, {
      error: "Invalid JSON body",
      code: "BAD_REQUEST",
      details: 'Expected JSON object: { "address": "0x..." }',
    });
  }

  const addressRaw =
    typeof body === "object" && body !== null && "address" in body
      ? (body as { address: unknown }).address
      : undefined;

  const validated = validateAddress(addressRaw);
  if (!validated.ok) {
    return errorJson(400, {
      error: "Invalid address",
      code: "BAD_REQUEST",
      details: validated.message,
    });
  }

  try {
    const result = await runAgentScan(validated.address);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
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
    console.error("[agent-scan]", err);
    return errorJson(500, {
      error: "Internal error",
      code: "INTERNAL",
      details: "Scan failed unexpectedly",
    });
  }
}

/** Paid A2MCP endpoint: $0.05 USDT0 via x402 when DEMO_MODE is off. */
export const POST = protectWithX402(handler, "agent");
