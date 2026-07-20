import { describe, expect, it } from "vitest";
import {
  explorerTxUrl,
  formatSettledAt,
  PROVEN_DISPATCHES,
  totalPaidDownstream,
  truncateHash,
} from "./receipts";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

describe("explorerTxUrl", () => {
  it("uses the canonical X Layer path that does not redirect", () => {
    // The shorter /explorer/x-layer/tx/ form 302s to this /evm/ path.
    expect(explorerTxUrl("0xabc")).toBe(
      "https://web3.okx.com/explorer/x-layer/evm/tx/0xabc",
    );
  });

  it("links the full hash, never the truncated form", () => {
    const hash = PROVEN_DISPATCHES[0]!.inbound.txHash;
    const url = explorerTxUrl(hash);
    expect(url).toContain(hash);
    expect(url).not.toContain("...");
  });
});

describe("truncateHash", () => {
  it("shortens to the documented display form", () => {
    expect(
      truncateHash(
        "0x47273b5ef523c65e193c13f2822f5342b6402379a34ca14d176b43f5ccf2d654",
      ),
    ).toBe("0x4727...d654");
  });

  it("leaves an already short value alone", () => {
    expect(truncateHash("0xabc")).toBe("0xabc");
  });
});

describe("formatSettledAt", () => {
  it("renders a deterministic UTC label", () => {
    // Locale-dependent formatting would differ between server and client.
    expect(formatSettledAt("2026-07-20T10:56:47.000Z")).toBe(
      "2026-07-20 10:56 UTC",
    );
  });
});

describe("totalPaidDownstream", () => {
  it("counts only settled hires", () => {
    expect(totalPaidDownstream()).toBe("0.001");
  });

  it("ignores declined hires entirely", () => {
    const total = totalPaidDownstream([
      {
        id: "t",
        goalSummary: "t",
        settledAtIso: "2026-07-20T00:00:00.000Z",
        inbound: { amountUsdt0: "0.50", txHash: "0x1", payer: "0x2" },
        hires: [
          { subcontractor: "A", service: "s", outcome: "paid", amountUsdt0: "0.05" },
          { subcontractor: "B", service: "s", outcome: "declined" },
        ],
      },
    ]);
    expect(total).toBe("0.050");
  });
});

describe("seeded proven dispatches", () => {
  it("carries only well formed, verifiable identifiers", () => {
    for (const dispatch of PROVEN_DISPATCHES) {
      expect(dispatch.inbound.txHash).toMatch(HASH_RE);
      expect(dispatch.inbound.payer).toMatch(ADDR_RE);
      expect(dispatch.settledAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Number.isNaN(Date.parse(dispatch.settledAtIso))).toBe(false);
      for (const hire of dispatch.hires) {
        if (hire.txHash) expect(hire.txHash).toMatch(HASH_RE);
        if (hire.payee) expect(hire.payee).toMatch(ADDR_RE);
      }
    }
  });

  it("never shows an amount or hash on a declined hire", () => {
    // A declined hire was refused before payment, so there is nothing to link.
    const declined = PROVEN_DISPATCHES.flatMap((d) => d.hires).filter(
      (h) => h.outcome === "declined",
    );
    expect(declined.length).toBeGreaterThan(0);
    for (const hire of declined) {
      expect(hire.txHash).toBeUndefined();
      expect(hire.amountUsdt0).toBeUndefined();
      expect(hire.note).toBeTruthy();
    }
  });

  it("matches the values verified on chain", () => {
    // Confirmed via eth_getTransactionReceipt on https://rpc.xlayer.tech:
    // both succeeded, USDT0 contract, decoded Transfer logs matching these.
    const dispatch = PROVEN_DISPATCHES[0]!;
    expect(dispatch.inbound.amountUsdt0).toBe("0.50");
    expect(dispatch.inbound.txHash).toBe(
      "0x47273b5ef523c65e193c13f2822f5342b6402379a34ca14d176b43f5ccf2d654",
    );
    expect(dispatch.inbound.payer).toBe(
      "0xab23ab7b1af66d06443bb06e899de4e17d86761c",
    );
    const certik = dispatch.hires.find((h) => h.subcontractor === "CertiK")!;
    expect(certik.amountUsdt0).toBe("0.001");
    expect(certik.txHash).toBe(
      "0x44339ea4e76b551e2f88c2cc2951a0b391680dab9c81385d4016c199fa276185",
    );
    expect(certik.payee).toBe("0x0df8e47790d2c1ec3e8dc31abc1ea8720519042f");
  });
});
