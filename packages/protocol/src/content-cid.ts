import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';

/**
 * Canonical WetDrool content identifiers are CIDv1, base32-lowercase,
 * raw-codec, SHA-256 multihashes. The final character is constrained by
 * unpadded base32's two zero padding bits.
 */
export const CANONICAL_RAW_SHA256_CID_PATTERN = /^bafkrei[a-h][a-z2-7]{50}[aeimquy4]$/u;

export function isCanonicalRawSha256Cid(value: string): boolean {
  if (!CANONICAL_RAW_SHA256_CID_PATTERN.test(value)) {
    return false;
  }

  try {
    const parsed = CID.parse(value);
    return (
      parsed.version === 1 &&
      parsed.code === raw.code &&
      parsed.multihash.code === 0x12 &&
      parsed.multihash.digest.byteLength === 32 &&
      parsed.toString() === value
    );
  } catch {
    return false;
  }
}
