import type { NextRequest } from "next/server";

/**
 * Same-origin check for the free playground route.
 * Browser POST from the landing page sends Origin matching Host.
 */
export function isSameOriginRequest(req: NextRequest): boolean {
  const host = req.headers.get("host")?.toLowerCase();
  if (!host) return false;

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const o = new URL(origin);
      return o.host.toLowerCase() === host;
    } catch {
      return false;
    }
  }

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const r = new URL(referer);
      return r.host.toLowerCase() === host;
    } catch {
      return false;
    }
  }

  // No Origin/Referer: not a browser same-site fetch. Reject playground abuse.
  return false;
}
