/** Client-safe constants (no next/server imports). */

export const PRICES = {
  agent: "$0.05",
  token: "$0.01",
  dispatch: "$0.50",
} as const;

/**
 * OKXFacilitatorClient's own default host. Duplicated here deliberately: the
 * SDK applies it via object spread, so passing an explicit `baseUrl: undefined`
 * overwrites it and yields the literal string "undefined" in the request URL.
 * Callers must resolve a concrete value rather than rely on that default.
 */
export const DEFAULT_FACILITATOR_BASE_URL = "https://web3.okx.com" as const;

export const X_LAYER_NETWORK = "eip155:196" as const;
export const USDT0_ADDRESS =
  "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as const;
