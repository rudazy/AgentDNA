import { getAddress, isAddress } from "viem";

export interface AddressValidation {
  ok: true;
  address: `0x${string}`;
}

export interface AddressValidationFail {
  ok: false;
  message: string;
}

/**
 * Validate and checksum an EVM address.
 * Accepts mixed case; rejects wrong length, non-hex, and invalid checksums when mixed case is EIP-55.
 */
export function validateAddress(
  input: unknown,
): AddressValidation | AddressValidationFail {
  if (typeof input !== "string" || input.trim() === "") {
    return {
      ok: false,
      message: 'Missing "address". Provide a 0x-prefixed EVM address on X Layer.',
    };
  }

  const raw = input.trim();

  if (!raw.startsWith("0x") && !raw.startsWith("0X")) {
    return {
      ok: false,
      message: "Address must start with 0x.",
    };
  }

  if (raw.length !== 42) {
    return {
      ok: false,
      message: `Address length must be 42 characters (got ${raw.length}). Example: 0x followed by 40 hex digits.`,
    };
  }

  if (!isAddress(raw, { strict: false })) {
    return {
      ok: false,
      message: "Address is not a valid hex EVM address.",
    };
  }

  try {
    const checksummed = getAddress(raw);
    return { ok: true, address: checksummed };
  } catch {
    return {
      ok: false,
      message:
        "Address failed checksum validation. Use a correct EIP-55 checksum or all-lowercase hex.",
    };
  }
}
