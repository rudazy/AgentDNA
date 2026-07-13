import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isSameOriginRequest } from "./origin";

function req(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/playground/scan", {
    method: "POST",
    headers,
  });
}

describe("isSameOriginRequest", () => {
  it("accepts matching Origin host", () => {
    expect(
      isSameOriginRequest(
        req({ host: "localhost:3000", origin: "http://localhost:3000" }),
      ),
    ).toBe(true);
  });

  it("rejects cross-origin", () => {
    expect(
      isSameOriginRequest(
        req({ host: "localhost:3000", origin: "https://evil.example" }),
      ),
    ).toBe(false);
  });

  it("accepts matching Referer when Origin is absent", () => {
    expect(
      isSameOriginRequest(
        req({
          host: "localhost:3000",
          referer: "http://localhost:3000/",
        }),
      ),
    ).toBe(true);
  });

  it("rejects missing Origin and Referer", () => {
    expect(isSameOriginRequest(req({ host: "localhost:3000" }))).toBe(false);
  });
});
