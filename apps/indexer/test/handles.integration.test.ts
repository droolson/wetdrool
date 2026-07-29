import { createHash, randomBytes } from 'node:crypto';

import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import { encodeMultibaseBase64Url, type NetworkId } from '@wokesocial/protocol';
import { MemoryContentAddressedStorage } from '@wokesocial/storage';

import {
  ManifestVerifier,
  OpenIndexer,
  PostgresProjectionStore,
  SOCIAL_PROTOCOL_EVENT_LAYOUT,
  type ProtocolEvent,
} from '../src/index.js';
import { migrate } from '../src/migrate.js';

const databaseUrl =
  process.env['INDEXER_INTEGRATION_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgresql://wokesocial_indexer_runtime:local-indexer-runtime-only@127.0.0.1:5432/wokesocial';
const migrationDatabaseUrl =
  process.env['INDEXER_INTEGRATION_DATABASE_MIGRATION_URL'] ??
  process.env['DATABASE_MIGRATION_URL'] ??
  'postgresql://wokesocial_indexer_migration:local-indexer-migration-only@127.0.0.1:5432/wokesocial';

describe('PostgreSQL handle projection integration', () => {
  it('rolls back invalid claims, releases exactly, and rebuilds a reclaim', async () => {
    await migrate(migrationDatabaseUrl);

    const networkId =
      `wokenet:v1:${bs58.encode(randomBytes(32))}:${SOCIAL_PROTOCOL_EVENT_LAYOUT.programId}` as NetworkId;
    const firstAddress = publicKey(101);
    const secondAddress = publicKey(102);
    const firstIdentityId = `wokesocialid:v1:${networkId}:${firstAddress}`;
    const secondIdentityId = `wokesocialid:v1:${networkId}:${secondAddress}`;
    const firstAuthority = publicKey(103);
    const secondAuthority = publicKey(104);
    const handleClaimAddress = publicKey(105);
    const handle = 'postgres_river';
    const handleHash = digestFor(handle);
    const projection = new PostgresProjectionStore(databaseUrl);
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(new MemoryContentAddressedStorage(), {
        authorize: () => Promise.resolve(false),
      }),
    );
    const firstIdentity = identityEvent(
      networkId,
      firstIdentityId,
      firstAddress,
      firstAuthority,
      1n,
      1,
    );
    const secondIdentity = identityEvent(
      networkId,
      secondIdentityId,
      secondAddress,
      secondAuthority,
      2n,
      2,
    );
    const claim: ProtocolEvent = {
      ...base(networkId, 3n, 3),
      type: 'handle-claimed',
      handleClaimAddress,
      identityId: firstIdentityId,
      authority: firstAuthority,
      identitySequence: 1n,
      handleHash,
      handle,
    };
    const release: ProtocolEvent = {
      ...base(networkId, 4n, 4),
      type: 'handle-released',
      handleClaimAddress,
      identityId: firstIdentityId,
      authority: firstAuthority,
      identitySequence: 2n,
      handleHash,
      handle,
    };
    const reclaim: ProtocolEvent = {
      ...base(networkId, 5n, 5),
      type: 'handle-claimed',
      handleClaimAddress,
      identityId: secondIdentityId,
      authority: secondAuthority,
      identitySequence: 1n,
      handleHash,
      handle,
    };

    try {
      await projection.clearProjection(networkId);
      for (const event of [firstIdentity, secondIdentity, claim]) {
        await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
      }
      await expect(projection.getHandle(networkId, handle)).resolves.toMatchObject({
        identityId: firstIdentityId,
        handleClaimAddress,
        identitySequence: 1n,
      });

      const substitutedRelease: ProtocolEvent = {
        ...release,
        handleClaimAddress: publicKey(106),
      };
      await expect(indexer.ingest(substitutedRelease)).rejects.toThrow('does not exactly match');
      await expect(projection.checkpoint(networkId)).resolves.toBe(3n);
      await expect(projection.getHandle(networkId, handle)).resolves.toMatchObject({
        identityId: firstIdentityId,
      });

      await expect(
        indexer.ingest({
          ...release,
          ...base(networkId, 2n, 9),
          identitySequence: 3n,
        }),
      ).rejects.toThrow('exactly advance');
      await expect(projection.checkpoint(networkId)).resolves.toBe(3n);

      // The failed event insert and checkpoint share the projection transaction. Reusing
      // its exact event position with corrected data proves the failed write rolled back.
      await expect(indexer.ingest(release)).resolves.toMatchObject({ applied: true });
      await expect(projection.checkpoint(networkId)).resolves.toBe(4n);
      await expect(projection.getHandle(networkId, handle)).resolves.toBeUndefined();
      await expect(
        indexer.ingest({
          ...claim,
          ...base(networkId, 5n, 10),
          identitySequence: release.identitySequence,
        }),
      ).rejects.toThrow('exactly advance');
      await expect(projection.checkpoint(networkId)).resolves.toBe(4n);

      await expect(indexer.ingest(reclaim)).resolves.toMatchObject({ applied: true });
      await expect(projection.getHandlesByIdentity(firstIdentityId)).resolves.toEqual([]);
      await expect(projection.getHandlesByIdentity(secondIdentityId)).resolves.toMatchObject([
        { handle, identityId: secondIdentityId },
      ]);

      await expect(
        indexer.ingest({
          ...claim,
          ...base(networkId, 6n, 6),
          handleClaimAddress: publicKey(107),
          identitySequence: 3n,
        }),
      ).rejects.toThrow('already active');
      const otherHandle = 'postgres_alt';
      await expect(
        indexer.ingest({
          ...claim,
          ...base(networkId, 6n, 7),
          handle: otherHandle,
          handleHash: digestFor(otherHandle),
          identitySequence: 3n,
        }),
      ).rejects.toThrow('already active');
      await expect(
        indexer.ingest({
          ...release,
          ...base(networkId, 6n, 8),
          identityId: firstIdentityId,
          authority: firstAuthority,
          identitySequence: 3n,
        }),
      ).rejects.toThrow('does not exactly match');
      await expect(projection.checkpoint(networkId)).resolves.toBe(5n);
      await expect(projection.getHandle(networkId, handle)).resolves.toMatchObject({
        identityId: secondIdentityId,
      });

      const before = await snapshot(
        projection,
        networkId,
        handle,
        firstIdentityId,
        secondIdentityId,
      );
      const rebuilt = await indexer.rebuild(networkId, [
        reclaim,
        release,
        claim,
        secondIdentity,
        firstIdentity,
      ]);
      expect(rebuilt).toHaveLength(5);
      expect(rebuilt.every((result) => result.applied)).toBe(true);
      await expect(
        snapshot(projection, networkId, handle, firstIdentityId, secondIdentityId),
      ).resolves.toEqual(before);
      await expect(indexer.ingest(reclaim)).resolves.toMatchObject({ applied: false });
    } finally {
      try {
        await projection.clearProjection(networkId);
      } finally {
        await projection.close();
      }
    }
  }, 45_000);
});

function identityEvent(
  networkId: NetworkId,
  identityId: string,
  identityAddress: string,
  rootAuthority: string,
  slot: bigint,
  signatureSeed: number,
): ProtocolEvent {
  return {
    ...base(networkId, slot, signatureSeed),
    type: 'identity-created',
    identityId,
    identityAddress,
    rootAuthority,
  };
}

function base(networkId: NetworkId, slot: bigint, signatureSeed: number) {
  return {
    networkId,
    programId: SOCIAL_PROTOCOL_EVENT_LAYOUT.programId,
    transactionSignature: signature(signatureSeed),
    slot,
    logIndex: 0,
    blockTime: new Date(Number(slot) * 1_000).toISOString(),
    finalized: true as const,
  };
}

async function snapshot(
  projection: PostgresProjectionStore,
  networkId: NetworkId,
  handle: string,
  firstIdentityId: string,
  secondIdentityId: string,
) {
  return {
    handle: await projection.getHandle(networkId, handle),
    firstIdentity: await projection.getHandlesByIdentity(firstIdentityId),
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

function digestFor(value: string): string {
  return encodeMultibaseBase64Url(createHash('sha256').update(value, 'utf8').digest());
}
