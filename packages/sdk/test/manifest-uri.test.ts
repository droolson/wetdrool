import { describe, expect, it } from 'vitest';

import { extractWokeManifestCid, parseWokeManifestUri } from '../src/index.js';

const cid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const transactionId = 'A'.repeat(43);

describe('WokeNet manifest URI policy', () => {
  it.each([
    [`ipfs://${cid}`, 'ipfs'],
    [`local://${cid}`, 'local'],
    [`ar://${transactionId}/${cid}`, 'ar'],
    [`https://example.test/${cid}`, 'https'],
    [`https://cdn.example.test:443/manifests/${cid}`, 'https'],
  ] as const)('extracts the canonical CID while retaining %s', (uri, scheme) => {
    expect(parseWokeManifestUri(uri)).toEqual({ cid, scheme, uri });
    expect(extractWokeManifestCid(uri)).toBe(cid);
  });

  it.each([
    '',
    'ftp://example.test/object',
    'ipfs://opaque',
    `ipfs://${cid}/extra`,
    `local://${cid}?download=1`,
    `ar://${transactionId}`,
    `ar://short/${cid}`,
    `ar://${transactionId}/${cid}/extra`,
    `https:///${cid}`,
    `https://user@example.test/${cid}`,
    `https://example.test/${cid}?download=1`,
    `https://example.test/${cid}#fragment`,
    `https://example.test//${cid}`,
    'ipfs://baaaaaaaaaaaaaaaaaaaa',
    `ipfs://bafkrez${'a'.repeat(52)}`,
    `ipfs://bafkreiz${'a'.repeat(51)}`,
    `local://${cid.toUpperCase()}`,
    `local://${cid.slice(0, 6)}z${cid.slice(7)}`,
    `local://${cid.slice(0, -1)}`,
    `local://${cid.slice(0, -1)}b`,
    'local://bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'local://bafkrgqgpqpqtk7xpxc67cvbikdlg3aah2yqoibilk4k5za7uveq5g3hjzzd5buj4lwc7fmh7qmmnfb365qxwhojrxvduc6ubuu4de6xze7nd4',
  ])('rejects a locator outside the exact on-chain grammar: %s', (uri) => {
    expect(parseWokeManifestUri(uri)).toBeUndefined();
    expect(extractWokeManifestCid(uri)).toBeUndefined();
  });

  it('accepts the 200-byte boundary and rejects one byte beyond it', () => {
    const prefix = 'https://example.test/';
    const directory = 'a'.repeat(200 - prefix.length - cid.length - 1);
    const maximum = `${prefix}${directory}/${cid}`;

    expect(new TextEncoder().encode(maximum)).toHaveLength(200);
    expect(extractWokeManifestCid(maximum)).toBe(cid);
    expect(extractWokeManifestCid(`${maximum}a`)).toBeUndefined();
  });
});
