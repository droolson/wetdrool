import { getContentCid } from '@wetdrool/protocol';
import type { ContentAddressedStorage, StorageReceipt } from '@wetdrool/storage';
import { describe, expect, it } from 'vitest';

import { LocalCasGateway } from '../lib/local-cas-gateway';
import { createCanonicalEnvelopeBytes } from './local-cas-fixture';

const bytes = createCanonicalEnvelopeBytes();
const policy = { permanence: 'deletion-compatible' as const };

describe('local CAS gateway integrity boundary', () => {
  it('rejects invalid and mismatched expected CIDs before storage', async () => {
    let calls = 0;
    const storage = fakeStorage({
      onCall: () => {
        calls += 1;
      },
      readBytes: bytes,
    });
    const gateway = new LocalCasGateway(storage, 1_000_000);

    await expect(gateway.put(bytes, '../../outside')).rejects.toMatchObject({
      code: 'invalid-cid',
    });
    await expect(
      gateway.put(bytes, await getContentCid(new Uint8Array([1]))),
    ).rejects.toMatchObject({
      code: 'cid-mismatch',
    });
    expect(calls).toBe(0);
  });

  it('rejects non-envelope JSON without invoking storage', async () => {
    let calls = 0;
    const invalidBytes = new TextEncoder().encode(
      '{"privateKey":"must-not-cross-this-boundary","prf":"also-forbidden"}',
    );
    const storage = fakeStorage({
      onCall: () => {
        calls += 1;
      },
      readBytes: invalidBytes,
    });

    await expect(
      new LocalCasGateway(storage, 1024 * 1024).put(
        invalidBytes,
        await getContentCid(invalidBytes),
      ),
    ).rejects.toMatchObject({
      code: 'invalid-envelope',
    });
    expect(calls).toBe(0);
  });

  it('rejects a provider receipt that does not identify the exact stored object', async () => {
    const cid = await getContentCid(bytes);
    const storage = fakeStorage({
      readBytes: bytes,
      receipt: receiptFor(cid, bytes.byteLength, {
        locator: `local://${await getContentCid(new Uint8Array([2]))}`,
      }),
    });

    await expect(new LocalCasGateway(storage, 1_000_000).put(bytes, cid)).rejects.toMatchObject({
      code: 'integrity-failure',
    });
  });

  it('rejects bytes that differ when read back even if a provider claims success', async () => {
    const cid = await getContentCid(bytes);
    const storage = fakeStorage({
      readBytes: new TextEncoder().encode('tampered'),
      receipt: receiptFor(cid, bytes.byteLength),
    });

    await expect(new LocalCasGateway(storage, 1_000_000).put(bytes, cid)).rejects.toMatchObject({
      code: 'integrity-failure',
    });
  });
});

function fakeStorage(options: {
  onCall?: () => void;
  readBytes: Uint8Array;
  receipt?: StorageReceipt;
}): ContentAddressedStorage {
  return {
    name: 'local-filesystem',
    version: '1',
    delete: async () => false,
    get: async () => {
      options.onCall?.();
      return options.readBytes;
    },
    has: async () => {
      options.onCall?.();
      return false;
    },
    health: async () => ({
      checkedAt: '2026-07-29T00:00:00.000Z',
      ok: true,
      provider: 'local-filesystem',
    }),
    put: async (storedBytes) => {
      options.onCall?.();
      return (
        options.receipt ?? receiptFor(await getContentCid(storedBytes), storedBytes.byteLength)
      );
    },
  };
}

function receiptFor(
  cid: string,
  byteLength: number,
  override: Partial<StorageReceipt> = {},
): StorageReceipt {
  return {
    byteLength,
    cid,
    locator: `local://${cid}`,
    policy,
    provider: 'local-filesystem',
    providerVersion: '1',
    publishedAt: '2026-07-29T00:00:00.000Z',
    verified: true,
    ...override,
  };
}
