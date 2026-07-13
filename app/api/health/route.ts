import { NextResponse } from "next/server";
import { SERVICE_NAME, SERVICE_VERSION } from "@/lib/types";
import { isDemoModeEnabled } from "@/lib/payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    service: SERVICE_NAME,
    status: "ok",
    version: SERVICE_VERSION,
    demoMode: isDemoModeEnabled(),
    timestamp: new Date().toISOString(),
  });
}
