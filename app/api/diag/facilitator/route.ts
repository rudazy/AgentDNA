/**
 * TEMPORARY diagnostic route. Delete after the facilitator issue is resolved.
 *
 * Runs the same signed, read-only getSupported call as
 * scripts/diagnose-facilitator.ts, but from the deployed server using that
 * server's own OKX_* environment. Signs no payment, settles nothing, spends
 * nothing.
 *
 * Disabled unless DIAG_TOKEN is set, and requires that token on the request.
 * A public endpoint that reports which credentials are configured and how the
 * payment rails are failing is useful to an attacker mapping the deployment,
 * so deploying this file alone must not expose anything. With DIAG_TOKEN
 * unset it answers 404, exactly as if the route did not exist.
 *
 * No secret values appear in the response. Keys are reported only as a
 * SHA-256 prefix.
 *
 * Usage:
 *   curl -s https://<host>/api/diag/facilitator -H "x-diag-token: <DIAG_TOKEN>"
 *
 * Cleanup: delete this file, then remove DIAG_TOKEN from the environment.
 */

import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { diagnoseFacilitator } from "@/lib/facilitator-diag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time compare that does not leak length through early exit. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function presentedToken(request: NextRequest): string {
  const header = request.headers.get("x-diag-token");
  if (header) return header.trim();
  const auth = request.headers.get("authorization") ?? "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.DIAG_TOKEN?.trim() ?? "";

  // Not configured means not deployed, as far as any caller can tell.
  if (expected === "") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const provided = presentedToken(request);
  if (provided === "" || !tokenMatches(provided, expected)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await diagnoseFacilitator();

  return NextResponse.json(
    { service: "facilitator-diagnostic", checkedAt: new Date().toISOString(), ...result },
    {
      status: 200,
      // Never let a diagnostic answer be served from a cache.
      headers: { "cache-control": "no-store, max-age=0" },
    },
  );
}
