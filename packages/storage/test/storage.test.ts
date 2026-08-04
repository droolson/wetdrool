import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LocalContentAddressedStorage,
  MemoryContentAddressedStorage,
  MultiProviderStorage,
  type ContentAddressedStorage,
  StorageError,
} from '../src/index.js';

const bytes = new TextEncoder().encode('signed canonical envelope');
const policy = { permanence: 'deletion-compatible' as const };

describe('content-addressed storage', () => {
  it('round-trips and deletes verified local bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wetdrool-cas-'));
    try {
      const storage = new LocalContentAddressedStorage({
        rootDirectory: root,
        clock: () => new Date('2026-07-28T12:00:00.000Z'),
      });
      const receipt = await storage.put(bytes, policy);

      expect(receipt.cid).toMatch(/^bafk/u);
      expect(receipt.locator).toBe(`local://${receipt.cid}`);
      await expect(storage.get(receipt.cid)).resolves.toEqual(bytes);
      await expect(storage.has(receipt.cid)).resolves.toBe(true);
      await expect(storage.delete(receipt.cid)).resolves.toBe(true);
      await expect(storage.has(receipt.cid)).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects local corruption', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wetdrool-cas-'));
    try {
      const storage = new LocalContentAddressedStorage({ rootDirectory: root });
      const receipt = await storage.put(bytes, policy);
      const objectPath = join(root, 'objects', receipt.cid.slice(1, 3), receipt.cid);
      expect((await readFile(objectPath)).byteLength).toBe(bytes.byteLength);
      await writeFile(objectPath, 'corrupted', { mode: 0o600 });

      await expect(storage.get(receipt.cid)).rejects.toMatchObject({
        code: 'integrity-failure',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires explicit consent for permanent policy', async () => {
    const storage = new MemoryContentAddressedStorage();
    await expect(storage.put(bytes, { permanence: 'permanent' })).rejects.toBeInstanceOf(
      StorageError,
    );
  });

  it('publishes the same CID to multiple providers', async () => {
    const first = new MemoryContentAddressedStorage();
    const second = new MemoryContentAddressedStorage();
    const storage = new MultiProviderStorage({
      providers: [first, second],
      minimumReplicas: 2,
    });

    const result = await storage.publish(bytes, policy);
    expect(result.receipts).toHaveLength(2);
    expect(new Set(result.receipts.map((receipt) => receipt.cid)).size).toBe(1);
    await expect(storage.get(result.cid)).resolves.toEqual(bytes);
  });

  it('rejects noncanonical CIDs at local, memory, and replication boundaries', async () => {
    const invalidCid = 'baaaaaaaaaaaaaaaaaaaa';
    const memory = new MemoryContentAddressedStorage();
    for (const operation of [
      memory.get(invalidCid),
      memory.has(invalidCid),
      memory.delete(invalidCid),
    ]) {
      await expect(operation).rejects.toMatchObject({ code: 'invalid-cid' });
    }

    const root = await mkdtemp(join(tmpdir(), 'wetdrool-cas-'));
    try {
      const local = new LocalContentAddressedStorage({ rootDirectory: root });
      await expect(local.get(invalidCid)).rejects.toMatchObject({ code: 'invalid-cid' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }

    let providerReads = 0;
    const provider: ContentAddressedStorage = {
      name: 'untrusted-provider',
      version: '1',
      put: async () => ({
        cid: invalidCid,
        provider: 'untrusted-provider',
        providerVersion: '1',
        locator: `ipfs://${invalidCid}`,
        byteLength: bytes.byteLength,
        publishedAt: '2026-07-28T12:00:00.000Z',
        policy,
        verified: true,
      }),
      get: async () => {
        providerReads += 1;
        return bytes;
      },
      has: async () => true,
      delete: async () => false,
      health: async () => ({
        provider: 'untrusted-provider',
        ok: true,
        checkedAt: '2026-07-28T12:00:00.000Z',
      }),
    };
    const replicated = new MultiProviderStorage({ providers: [provider] });
    await expect(replicated.publish(bytes, policy)).rejects.toMatchObject({
      code: 'replication-failure',
    });
    await expect(replicated.get(invalidCid)).rejects.toMatchObject({ code: 'invalid-cid' });
    expect(providerReads).toBe(0);
  });
});
