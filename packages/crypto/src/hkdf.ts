import {
  frameDomain,
  getWebCrypto,
  MAX_CONTEXT_BYTES,
  requireBytes,
  requireDomain,
  requireInteger,
  toArrayBuffer,
} from './internal.js';

export interface HkdfSha256Input {
  /** High-entropy input key material, not a user password. */
  readonly inputKeyMaterial: Uint8Array;
  /** A unique, non-secret salt of at least 128 bits. */
  readonly salt: Uint8Array;
  /** Operation-specific application domain. There is deliberately no default. */
  readonly domain: string;
  /** Public context binding, such as conversation and key-version identifiers. */
  readonly context?: Uint8Array;
  /** Output length in bytes. HKDF-SHA-256 permits at most 255 × 32 bytes. */
  readonly length: number;
}

export async function hkdfSha256(input: HkdfSha256Input): Promise<Uint8Array> {
  const inputKeyMaterial = requireBytes(input.inputKeyMaterial, 'inputKeyMaterial', {
    minimum: 16,
    maximum: 64 * 1024,
  });
  const salt = requireBytes(input.salt, 'salt', {
    minimum: 16,
    maximum: 64 * 1024,
  });
  const context = requireBytes(input.context ?? new Uint8Array(), 'context', {
    maximum: MAX_CONTEXT_BYTES,
  });
  const domain = requireDomain(input.domain);
  const length = requireInteger(input.length, 'length', 1, 255 * 32);
  const info = frameDomain('hkdf-sha256', domain, [context]);

  const key = await getWebCrypto().subtle.importKey(
    'raw',
    toArrayBuffer(inputKeyMaterial),
    'HKDF',
    false,
    ['deriveBits'],
  );
  const bits = await getWebCrypto().subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(info),
    },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}
