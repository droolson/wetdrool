import { CryptoInputError } from './errors.js';
import { encodeBase64Url, getWebCrypto, requireInteger } from './internal.js';

const RANDOM_ID_PREFIX_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;

/**
 * Returns fresh cryptographically secure bytes. WebCrypto intentionally limits
 * one getRandomValues call to 65,536 bytes.
 */
export function secureRandomBytes(length: number): Uint8Array {
  const byteLength = requireInteger(length, 'length', 1, 65_536);
  return getWebCrypto().getRandomValues(new Uint8Array(byteLength));
}

/**
 * Returns an opaque identifier with at least 128 bits of entropy by default.
 * Prefixes are labels only and do not weaken or domain-separate key material.
 */
export function secureRandomId(
  options: { readonly bytes?: number; readonly prefix?: string } = {},
): string {
  const byteLength = requireInteger(options.bytes ?? 16, 'bytes', 16, 64);
  const prefix = options.prefix ?? 'sw';
  if (!RANDOM_ID_PREFIX_PATTERN.test(prefix)) {
    throw new CryptoInputError(
      'prefix must be 1-32 lowercase ASCII letters, digits, or hyphens and begin with a letter.',
    );
  }
  return `${prefix}_${encodeBase64Url(secureRandomBytes(byteLength))}`;
}
