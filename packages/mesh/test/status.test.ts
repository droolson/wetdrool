import { describe, expect, it } from 'vitest';

import {
  MemorySpaceStore,
  MeshNotConfiguredError,
  UnconfiguredMeshTransport,
  asMeshObjectId,
  asPeerId,
  asSpaceId,
  getMeshCapabilityReport,
} from '../src/index.js';

describe('@wetdrool/mesh', () => {
  it('reports any-sync foundation without claiming production mesh', () => {
    const report = getMeshCapabilityReport();
    expect(report.foundation).toBe('anyproto/any-sync');
    expect(report.productionMeshDeployed).toBe(false);
    expect(report.localFirst).toBe(true);
    expect(report.e2eeSpaces).toBe(true);
    expect(report.transports).toEqual(['local-only']);
    expect(report.upstream.anySync).toContain('anyproto/any-sync');
  });

  it('fails closed on unconfigured transport', async () => {
    const transport = new UnconfiguredMeshTransport();
    await expect(transport.publish()).rejects.toBeInstanceOf(MeshNotConfiguredError);
  });

  it('stores envelopes in memory space store', async () => {
    const store = new MemorySpaceStore();
    const spaceId = asSpaceId('space-local-1');
    const objectId = asMeshObjectId('obj-1');
    await store.open(spaceId);
    await store.put({
      version: 1,
      spaceId,
      objectId,
      ciphertext: new Uint8Array([1, 2, 3]),
      contentType: 'application/wetdrool-mesh+json',
      senderPeerId: asPeerId('peer-a'),
    });
    const got = await store.get(spaceId, objectId);
    expect(got?.objectId).toBe(objectId);
    expect(got?.ciphertext).toEqual(new Uint8Array([1, 2, 3]));
    await store.close();
  });
});
