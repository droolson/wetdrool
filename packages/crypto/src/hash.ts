import {
  frameDomain,
  getWebCrypto,
  MAX_DIGEST_INPUT_BYTES,
  requireBytes,
  requireDomain,
  toArrayBuffer,
} from './internal.js';

export interface Sha256Input {
  readonly domain: string;
  readonly data: Uint8Array;
}

/**
 * Computes a domain-separated SHA-256 digest. The same data intentionally
 * hashes differently in different application domains.
 */
export async function sha256(input: Sha256Input): Promise<Uint8Array> {
  const data = requireBytes(input.data, 'data', { maximum: MAX_DIGEST_INPUT_BYTES });
  const domain = requireDomain(input.domain);
  const framed = frameDomain('sha256', domain, [data]);
  const digest = await getWebCrypto().subtle.digest('SHA-256', toArrayBuffer(framed));
  return new Uint8Array(digest);
}
