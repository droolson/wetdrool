import { createHash } from 'node:crypto';

import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import { encodeMultibaseBase64Url, type NetworkId } from '@socially-woke/protocol';
import { MemoryContentAddressedStorage } from '@socially-woke/storage';

import {
  buildIndexerApp,
  decodeAnchorEventLog,
  ManifestVerifier,
  MemoryProjectionStore,
  OpenIndexer,
  protocolEventSchema,
  SOCIAL_PROTOCOL_EVENT_LAYOUT,
  SolanaEventMaterializer,
  type HandleClaimedEvent,
  type ProtocolEvent,
} from '../src/index.js';

const programId = SOCIAL_PROTOCOL_EVENT_LAYOUT.programId;
const networkId = `woke:v1:${publicKey(1)}:${programId}` as NetworkId;
const identityAddress = publicKey(2);
const secondIdentityAddress = publicKey(3);
const identityId = `swid:v1:${networkId}:${identityAddress}`;
const secondIdentityId = `swid:v1:${networkId}:${secondIdentityAddress}`;
const rootAuthority = publicKey(4);
const secondRootAuthority = publicKey(5);
const configAddress = publicKey(6);
const handleClaimAddress = publicKey(7);
const handle = 'river_chen';
const handleHashBytes = sha256(handle);
const handleHash = encodeMultibaseBase64Url(handleHashBytes);

describe('handle Anchor events', () => {
  it('decodes and materializes the exact claim and release layouts', async () => {
    const claimed = decodeAnchorEventLog(
      eventData(
        SOCIAL_PROTOCOL_EVENT_LAYOUT.events.HandleClaimed,
        u16(1),
        pubkey(configAddress),
        pubkey(handleClaimAddress),
        pubkey(identityAddress),
        pubkey(rootAuthority),
        u64(9n),
        handleHashBytes,
        borshString(handle),
        u64(42n),
      ),
    );
    expect(claimed).toEqual({
      kind: 'handle-claimed',
      eventVersion: 1,
      config: configAddress,
      handleClaim: handleClaimAddress,
      identity: identityAddress,
      authority: rootAuthority,
      identitySequence: 9n,
      handleHash: handleHashBytes,
      handle,
      claimedAtSlot: 42n,
    });

    const released = decodeAnchorEventLog(
      eventData(
        SOCIAL_PROTOCOL_EVENT_LAYOUT.events.HandleReleased,
        u16(1),
        pubkey(configAddress),
        pubkey(handleClaimAddress),
        pubkey(identityAddress),
        pubkey(rootAuthority),
        u64(12n),
        handleHashBytes,
        borshString(handle),
        u64(45n),
      ),
    );
    expect(released).toMatchObject({
      kind: 'handle-released',
      identitySequence: 12n,
      releasedAtSlot: 45n,
    });

    const storage = new MemoryContentAddressedStorage();
    const projection = new MemoryProjectionStore();
    const materializer = new SolanaEventMaterializer(storage, projection);
    await expect(materializer.materialize(claimed, context(42n, 10))).resolves.toEqual({
      ...base(42n, 10),
      type: 'handle-claimed',
      handleClaimAddress,
      identityId,
      authority: rootAuthority,
      identitySequence: 9n,
      handleHash,
      handle,
    });
    await expect(materializer.materialize(released, context(45n, 11))).resolves.toEqual({
      ...base(45n, 11),
      type: 'handle-released',
      handleClaimAddress,
      identityId,
      authority: rootAuthority,
      identitySequence: 12n,
      handleHash,
      handle,
    });
  });

  it('rejects event-slot substitution during materialization', async () => {
    const projection = new MemoryProjectionStore();
    const materializer = new SolanaEventMaterializer(
      new MemoryContentAddressedStorage(),
      projection,
    );
    await expect(
      materializer.materialize(
        {
          kind: 'handle-claimed',
          eventVersion: 1,
          config: configAddress,
          handleClaim: handleClaimAddress,
          identity: identityAddress,
          authority: rootAuthority,
          identitySequence: 1n,
          handleHash: handleHashBytes,
          handle,
          claimedAtSlot: 41n,
        },
        context(42n, 12),
      ),
    ).rejects.toThrow('does not match transaction slot');
  });
});

describe('handle event validation', () => {
  it.each([
    ['too short', { handle: 'ab', handleHash: digestFor('ab') }],
    ['uppercase', { handle: 'River', handleHash: digestFor('River') }],
    ['leading underscore', { handle: '_river', handleHash: digestFor('_river') }],
    ['repeated underscore', { handle: 'river__chen', handleHash: digestFor('river__chen') }],
    ['too long', { handle: 'a'.repeat(31), handleHash: digestFor('a'.repeat(31)) }],
    ['mismatched digest', { handleHash: digestFor('different') }],
    ['zero sequence', { identitySequence: 0n }],
    ['negative sequence', { identitySequence: -1n }],
    ['overflowing sequence', { identitySequence: 18_446_744_073_709_551_616n }],
  ] as const)('rejects %s', (_label, override) => {
    expect(
      protocolEventSchema.safeParse({
        ...claimEvent(3n, 3),
        ...override,
      }).success,
    ).toBe(false);
  });
});

describe('memory handle projection', () => {
  it('enforces global uniqueness and exact release, then replays a reclaim identically', async () => {
    const projection = new MemoryProjectionStore();
    const indexer = createIndexer(projection);
    const identity = identityEvent(identityId, identityAddress, rootAuthority, 1n, 1);
    const secondIdentity = identityEvent(
      secondIdentityId,
      secondIdentityAddress,
      secondRootAuthority,
      2n,
      2,
    );
    const claim = claimEvent(3n, 3);
    const release: ProtocolEvent = {
      ...base(4n, 4),
      type: 'handle-released',
      handleClaimAddress,
      identityId,
      authority: rootAuthority,
      identitySequence: 4n,
      handleHash,
      handle,
    };
    const reclaim: ProtocolEvent = {
      ...base(5n, 5),
      type: 'handle-claimed',
      handleClaimAddress,
      identityId: secondIdentityId,
      authority: secondRootAuthority,
      identitySequence: 1n,
      handleHash,
      handle,
    };

    for (const event of [identity, secondIdentity, claim]) {
      await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
    }
    await expect(projection.getHandle(networkId, handle)).resolves.toMatchObject({
      identityId,
      handleClaimAddress,
      handleHash,
      claimedSlot: 3n,
    });
    await expect(projection.getHandlesByIdentity(identityId)).resolves.toMatchObject([{ handle }]);

    await expect(
      indexer.ingest({
        ...claimEvent(4n, 20),
        handleClaimAddress: publicKey(20),
        identityId: secondIdentityId,
        authority: secondRootAuthority,
        identitySequence: 1n,
      }),
    ).rejects.toThrow('already active');
    const otherHandle = 'river_alt';
    await expect(
      indexer.ingest({
        ...claimEvent(4n, 21),
        handle: otherHandle,
        handleHash: digestFor(otherHandle),
      }),
    ).rejects.toThrow('already active');
    await expect(
      indexer.ingest({
        ...release,
        transactionSignature: signature(22),
        identitySequence: 1n,
      }),
    ).rejects.toThrow('exactly match');
    await expect(
      indexer.ingest({
        ...release,
        transactionSignature: signature(23),
        identityId: secondIdentityId,
        authority: secondRootAuthority,
      }),
    ).rejects.toThrow('exactly match');
    await expect(
      indexer.ingest({
        ...release,
        ...base(2n, 24),
        identitySequence: 5n,
      }),
    ).rejects.toThrow('exactly match');
    await expect(projection.checkpoint(networkId)).resolves.toBe(3n);

    await expect(indexer.ingest(release)).resolves.toMatchObject({ applied: true });
    await expect(projection.getHandle(networkId, handle)).resolves.toBeUndefined();
    await expect(projection.getHandlesByIdentity(identityId)).resolves.toEqual([]);
    await expect(
      indexer.ingest({
        ...claim,
        ...base(5n, 25),
        identitySequence: release.identitySequence,
      }),
    ).rejects.toThrow('does not advance');
    await expect(projection.checkpoint(networkId)).resolves.toBe(4n);

    await expect(indexer.ingest(reclaim)).resolves.toMatchObject({ applied: true });
    await expect(projection.getHandle(networkId, handle)).resolves.toMatchObject({
      identityId: secondIdentityId,
      identitySequence: 1n,
      claimedSlot: 5n,
    });

    const before = await handleSnapshot(projection);
    const replay = await indexer.rebuild(networkId, [
      reclaim,
      release,
      claim,
      secondIdentity,
      identity,
    ]);
    expect(replay).toHaveLength(5);
    expect(replay.every((result) => result.applied)).toBe(true);
    await expect(handleSnapshot(projection)).resolves.toEqual(before);
    await expect(indexer.ingest(reclaim)).resolves.toMatchObject({ applied: false });
  });

  it('rejects a non-current root authority without advancing its checkpoint', async () => {
    const projection = new MemoryProjectionStore();
    const indexer = createIndexer(projection);
    await indexer.ingest(identityEvent(identityId, identityAddress, rootAuthority, 1n, 30));
    await expect(
      indexer.ingest({
        ...claimEvent(2n, 31),
        authority: secondRootAuthority,
      }),
    ).rejects.toThrow('current identity root authority');
    await expect(projection.checkpoint(networkId)).resolves.toBe(1n);
    await expect(projection.getHandle(networkId, handle)).resolves.toBeUndefined();
  });
});

describe('handle HTTP contract', () => {
  it('resolves active handles and stops resolving them after release', async () => {
    const projection = new MemoryProjectionStore();
    const indexer = createIndexer(projection);
    await indexer.ingest(identityEvent(identityId, identityAddress, rootAuthority, 1n, 40));
    await indexer.ingest(claimEvent(2n, 41));
    const app = await buildIndexerApp({ projection, logger: false });

    try {
      const byName = await app.inject({
        method: 'GET',
        url: `/v1/handles/${handle}?network=${encodeURIComponent(networkId)}`,
      });
      expect(byName.statusCode).toBe(200);
      expect(byName.json()).toMatchObject({
        canonical: false,
        handle: {
          handle,
          identityId,
          identitySequence: '1',
          claimedSlot: '2',
        },
      });

      const byIdentity = await app.inject({
        method: 'GET',
        url: `/v1/identities/${encodeURIComponent(identityId)}/handles`,
      });
      expect(byIdentity.statusCode).toBe(200);
      expect(byIdentity.json()).toMatchObject({
        canonical: false,
        identityId,
        handles: [{ handle }],
      });
      const openApi = await app.inject({ method: 'GET', url: '/openapi.json' });
      expect(openApi.json()).toMatchObject({
        paths: {
          '/v1/handles/{handle}': { get: { summary: expect.any(String) } },
          '/v1/identities/{identityId}/handles': {
            get: { summary: expect.any(String) },
          },
        },
      });

      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/handles/${handle}`,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/handles/River?network=${encodeURIComponent(networkId)}`,
          })
        ).statusCode,
      ).toBe(400);

      await indexer.ingest({
        ...base(3n, 42),
        type: 'handle-released',
        handleClaimAddress,
        identityId,
        authority: rootAuthority,
        identitySequence: 2n,
        handleHash,
        handle,
      });
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/handles/${handle}?network=${encodeURIComponent(networkId)}`,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/identities/${encodeURIComponent(identityId)}/handles`,
          })
        ).json(),
      ).toMatchObject({ handles: [] });
    } finally {
      await app.close();
      await projection.close();
    }
  });
});

function createIndexer(projection: MemoryProjectionStore): OpenIndexer {
  return new OpenIndexer(
    projection,
    new ManifestVerifier(new MemoryContentAddressedStorage(), {
      authorize: () => Promise.resolve(false),
    }),
  );
}

function identityEvent(
  projectedIdentityId: string,
  address: string,
  authority: string,
  slot: bigint,
  signatureSeed: number,
): ProtocolEvent {
  return {
    ...base(slot, signatureSeed),
    type: 'identity-created',
    identityId: projectedIdentityId,
    identityAddress: address,
    rootAuthority: authority,
  };
}

function claimEvent(slot: bigint, signatureSeed: number): HandleClaimedEvent {
  return {
    ...base(slot, signatureSeed),
    type: 'handle-claimed',
    handleClaimAddress,
    identityId,
    authority: rootAuthority,
    identitySequence: 1n,
    handleHash,
    handle,
  };
}

function base(slot: bigint, signatureSeed: number) {
  return {
    networkId,
    programId,
    transactionSignature: signature(signatureSeed),
    slot,
    logIndex: 0,
    blockTime: new Date(Number(slot) * 1_000).toISOString(),
    finalized: true as const,
  };
}

function context(slot: bigint, signatureSeed: number) {
  return {
    networkId,
    programId,
    transactionSignature: signature(signatureSeed),
    slot,
    logIndex: 0,
    blockTime: Number(slot),
  };
}

async function handleSnapshot(projection: MemoryProjectionStore) {
  return {
    handle: await projection.getHandle(networkId, handle),
    firstIdentity: await projection.getHandlesByIdentity(identityId),
    secondIdentity: await projection.getHandlesByIdentity(secondIdentityId),
    checkpoint: await projection.checkpoint(networkId),
  };
}

function signature(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 64 }, () => seed));
}

function publicKey(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 32 }, () => seed));
}

function sha256(value: string): Uint8Array {
  return Uint8Array.from(createHash('sha256').update(value, 'utf8').digest());
}

function digestFor(value: string): string {
  return encodeMultibaseBase64Url(sha256(value));
}

function eventData(discriminator: readonly number[], ...fields: readonly Uint8Array[]): string {
  return Buffer.concat([
    Buffer.from(discriminator),
    ...fields.map((field) => Buffer.from(field)),
  ]).toString('base64');
}

function u16(value: number): Uint8Array {
  const result = new Uint8Array(2);
  new DataView(result.buffer).setUint16(0, value, true);
  return result;
}

function u64(value: bigint): Uint8Array {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, value, true);
  return result;
}

function borshString(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, encoded.byteLength, true);
  return Uint8Array.from([...length, ...encoded]);
}

function pubkey(value: string): Uint8Array {
  return bs58.decode(value);
}
