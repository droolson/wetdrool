import { describe, expect, it } from 'vitest';

import {
  cidSchema,
  extractWokeManifestCid,
  getContentCid,
  isCanonicalRawSha256Cid,
  parseWokeManifestUri,
  verifyContentCid,
} from '../src/index.js';

const canonicalCid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const arweaveTransactionId = 'A'.repeat(43);
const invalidCids = [
  'baaaaaaaaaaaaaaaaaaaa',
  canonicalCid.toUpperCase(),
  `bafkrez${'a'.repeat(52)}`,
  `bafkreiz${'a'.repeat(51)}`,
  `${canonicalCid.slice(0, 6)}z${canonicalCid.slice(7)}`,
  canonicalCid.slice(0, -1),
  `${canonicalCid.slice(0, -1)}b`,
  'bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
  'bafkrgqgpqpqtk7xpxc67cvbikdlg3aah2yqoibilk4k5za7uveq5g3hjzzd5buj4lwc7fmh7qmmnfb365qxwhojrxvduc6ubuu4de6xze7nd4',
] as const;

describe('canonical content CID contract', () => {
  it('accepts only canonical CIDv1 raw SHA-256 base32 identifiers', async () => {
    const empty = new Uint8Array();
    await expect(getContentCid(empty)).resolves.toBe(canonicalCid);
    expect(cidSchema.parse(canonicalCid)).toBe(canonicalCid);
    expect(isCanonicalRawSha256Cid(canonicalCid)).toBe(true);
    await expect(verifyContentCid(empty, canonicalCid)).resolves.toBe(true);

    for (const invalid of invalidCids) {
      expect(cidSchema.safeParse(invalid).success, invalid).toBe(false);
      expect(isCanonicalRawSha256Cid(invalid), invalid).toBe(false);
      await expect(verifyContentCid(empty, invalid), invalid).resolves.toBe(false);
    }
  });

  it.each([
    [`ipfs://${canonicalCid}`, 'ipfs'],
    [`local://${canonicalCid}`, 'local'],
    [`ar://${arweaveTransactionId}/${canonicalCid}`, 'ar'],
    [`https://example.test/${canonicalCid}`, 'https'],
    [`https://cdn.example.test:443/manifests/${canonicalCid}`, 'https'],
  ] as const)('extracts a canonical CID from %s', (uri, scheme) => {
    expect(parseWokeManifestUri(uri)).toEqual({
      cid: canonicalCid,
      scheme,
      uri,
    });
    expect(extractWokeManifestCid(uri)).toBe(canonicalCid);
  });

  it.each(
    invalidCids.flatMap((cid) => [
      `ipfs://${cid}`,
      `local://${cid}`,
      `ar://${arweaveTransactionId}/${cid}`,
      `https://example.test/${cid}`,
    ]),
  )('rejects a noncanonical manifest locator without normalization: %s', (uri) => {
    expect(parseWokeManifestUri(uri)).toBeUndefined();
    expect(extractWokeManifestCid(uri)).toBeUndefined();
  });
});
