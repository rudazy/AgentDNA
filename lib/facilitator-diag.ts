/**
 * Read-only probe of the x402 facilitator handshake that gates every paid route.
 *
 * Mirrors OKXFacilitatorClient.getSupported exactly:
 *   GET {baseUrl}/api/v6/pay/x402/supported
 *   HMAC-SHA256 over timestamp + "GET" + path, no body
 *   OK-ACCESS-KEY / SIGN / TIMESTAMP / PASSPHRASE
 *
 * Signs no payment, settles nothing, spends nothing. Shared by the CLI script
 * and the temporary diagnostic route so the two cannot drift apart.
 *
 * Nothing here returns a secret value. Credentials are reported only as a
 * SHA-256 prefix, which is enough to tell two key sets apart and not enough to
 * reconstruct either.
 */

import crypto from "crypto";
import { DEFAULT_FACILITATOR_BASE_URL, X_LAYER_NETWORK } from "./constants";
import { getFacilitatorBaseUrl, redactSecrets } from "./x402-wiring";

export const SUPPORTED_PATH = "/api/v6/pay/x402/supported";
export { DEFAULT_FACILITATOR_BASE_URL };

export interface FacilitatorKind {
  x402Version?: number;
  network?: string;
  scheme?: string;
  asset?: string;
}

export interface FacilitatorDiagnosis {
  ok: boolean;
  baseUrl: string;
  baseUrlConfigured: boolean;
  baseUrlWarning: string | null;
  credentials: {
    apiKeySet: boolean;
    secretKeySet: boolean;
    passphraseSet: boolean;
    /** First 8 hex chars of SHA-256. Not reversible, not a secret. */
    apiKeyFingerprint: string | null;
    okxosApiKeyFingerprint: string | null;
    /** True when OKX_API_KEY equals OKXOS_API_KEY, a common misconfiguration. */
    sameKeyAsOkxosDataApi: boolean;
  };
  status: number | null;
  hasXLayerExactKind: boolean;
  kindCount: number;
  kinds: FacilitatorKind[];
  /** Scrubbed and truncated upstream error text, only for non-2xx. */
  errorBody: string | null;
  diagnosis: string;
}

/** First 8 hex chars of SHA-256. Safe to expose. */
export function fingerprint(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function baseUrlWarningFor(configured: string): string | null {
  if (configured === "") return null;
  if (configured.includes("/facilitator")) {
    return (
      "OKX_FACILITATOR_BASE_URL contains /facilitator. That is the default for the " +
      "generic HTTPFacilitatorClient, not for OKXFacilitatorClient, which appends " +
      "/api/v6/pay/x402/... itself. This yields a 404 and therefore zero kinds."
    );
  }
  if (configured.endsWith("/")) {
    return "OKX_FACILITATOR_BASE_URL ends with a slash, producing a double slash in the path.";
  }
  if (configured !== DEFAULT_FACILITATOR_BASE_URL) {
    return `OKX_FACILITATOR_BASE_URL is set to a non-default host. Expected ${DEFAULT_FACILITATOR_BASE_URL}.`;
  }
  return null;
}

export async function diagnoseFacilitator(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<FacilitatorDiagnosis> {
  const apiKey = env.OKX_API_KEY?.trim() ?? "";
  const secretKey = env.OKX_SECRET_KEY?.trim() ?? "";
  const passphrase = env.OKX_PASSPHRASE?.trim() ?? "";
  const okxosApiKey = env.OKXOS_API_KEY?.trim() ?? "";
  const configured = env.OKX_FACILITATOR_BASE_URL?.trim() ?? "";
  // Same resolver the real client uses, so this reports the URL actually called.
  const baseUrl = getFacilitatorBaseUrl(env);

  const credentials: FacilitatorDiagnosis["credentials"] = {
    apiKeySet: apiKey !== "",
    secretKeySet: secretKey !== "",
    passphraseSet: passphrase !== "",
    apiKeyFingerprint: apiKey ? fingerprint(apiKey) : null,
    okxosApiKeyFingerprint: okxosApiKey ? fingerprint(okxosApiKey) : null,
    sameKeyAsOkxosDataApi: apiKey !== "" && apiKey === okxosApiKey,
  };

  const base = {
    baseUrl,
    baseUrlConfigured: configured !== "",
    baseUrlWarning: baseUrlWarningFor(configured),
    credentials,
    kinds: [] as FacilitatorKind[],
    kindCount: 0,
    hasXLayerExactKind: false,
    errorBody: null as string | null,
  };

  if (!apiKey || !secretKey || !passphrase) {
    return {
      ...base,
      ok: false,
      status: null,
      diagnosis:
        "One or more of OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE is missing in this environment.",
    };
  }

  const timestamp = new Date().toISOString();
  const sign = crypto
    .createHmac("sha256", secretKey)
    .update(`${timestamp}GET${SUPPORTED_PATH}`)
    .digest("base64");

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${SUPPORTED_PATH}`, {
      method: "GET",
      headers: {
        "OK-ACCESS-KEY": apiKey,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": passphrase,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      ok: false,
      status: null,
      errorBody: redactSecrets(detail, env),
      diagnosis:
        "The request failed before any response. The facilitator host is unreachable from this environment.",
    };
  }

  const text = await response.text();

  if (!response.ok) {
    return {
      ...base,
      ok: false,
      status: response.status,
      errorBody: redactSecrets(text, env).slice(0, 300),
      diagnosis:
        response.status === 401 || response.status === 403
          ? "Credentials rejected. The SA key is wrong, revoked, IP restricted, or not provisioned for x402 settlement."
          : response.status === 404
            ? "Path not found. Almost always a wrong OKX_FACILITATOR_BASE_URL; it must be the host only."
            : `Facilitator returned ${response.status}. Zero payment kinds will load, so every paid route fails.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ...base,
      ok: false,
      status: response.status,
      diagnosis: "Facilitator returned 200 but the body was not JSON.",
    };
  }

  const payload = (parsed as { data?: unknown }).data ?? parsed;
  const rawKinds = (payload as { kinds?: unknown }).kinds;
  const kinds: FacilitatorKind[] = Array.isArray(rawKinds)
    ? rawKinds.map((k) => {
        const kind = k as FacilitatorKind;
        return {
          x402Version: kind.x402Version,
          network: kind.network,
          scheme: kind.scheme,
          asset: kind.asset,
        };
      })
    : [];

  const hasXLayerExactKind = kinds.some(
    (k) => k.network === X_LAYER_NETWORK && k.scheme === "exact",
  );

  return {
    ...base,
    ok: hasXLayerExactKind,
    status: response.status,
    kinds,
    kindCount: kinds.length,
    hasXLayerExactKind,
    diagnosis:
      kinds.length === 0
        ? "Authenticated successfully but the kinds list is empty. Credentials are fine; the account is not provisioned for x402 settlement. No env or code change fixes this."
        : hasXLayerExactKind
          ? `Healthy. ${X_LAYER_NETWORK} with the exact scheme is offered.`
          : `Kinds were returned but none match ${X_LAYER_NETWORK} with the exact scheme, which is what this app quotes.`,
  };
}
