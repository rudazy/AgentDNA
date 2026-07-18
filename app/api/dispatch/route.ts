import { NextRequest, NextResponse } from "next/server";
import { ForemanError, runDispatch, type DispatchContext } from "@/lib/foreman";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/ratelimit";
import { protectWithX402 } from "@/lib/x402-server";
import type { ErrorBody } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Dispatch fans out to marketplace ASPs; allow more headroom than the scans.
export const maxDuration = 60;

function errorJson(status: number, body: ErrorBody & { capabilities?: string[] }) {
  return NextResponse.json(body, { status });
}

function parseContext(raw: unknown): DispatchContext {
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

async function handler(req: NextRequest) {
  const ip = clientIpFromHeaders(req.headers);
  const rl = checkRateLimit(`dispatch:${ip}`);
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
      details:
        'Expected JSON object: { "goal": "<what to do>", "budget": 0.35, "context": { ... } }',
    });
  }

  if (typeof body !== "object" || body === null) {
    return errorJson(400, {
      error: "Invalid JSON body",
      code: "BAD_REQUEST",
      details:
        'Expected JSON object: { "goal": "<what to do>", "budget": 0.35, "context": { ... } }',
    });
  }

  const record = body as { goal?: unknown; budget?: unknown; context?: unknown };

  try {
    const result = await runDispatch({
      goal: typeof record.goal === "string" ? record.goal : "",
      budget: typeof record.budget === "number" ? record.budget : undefined,
      context: parseContext(record.context),
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof ForemanError) {
      return errorJson(err.status, {
        error: err.message,
        code:
          err.code === "BAD_REQUEST"
            ? "BAD_REQUEST"
            : err.code === "SPEND_LIMIT"
              ? "BAD_REQUEST"
              : err.code === "UNRESOLVABLE"
                ? "BAD_REQUEST"
                : "INTERNAL",
        details:
          err.code === "UNRESOLVABLE"
            ? "Foreman currently takes on the capabilities listed under capabilities."
            : undefined,
        ...(err.details ? { capabilities: err.details } : {}),
      });
    }
    console.error("[dispatch]", err);
    return errorJson(500, {
      error: "Internal error",
      code: "INTERNAL",
      details: "Dispatch failed unexpectedly",
    });
  }
}

/** Paid A2MCP endpoint: 0.50 USDT0 via x402 when DEMO_MODE is off. */
export const POST = protectWithX402(handler, "dispatch");
