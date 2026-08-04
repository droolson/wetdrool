import { randomBytes } from 'node:crypto';

import bs58 from 'bs58';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import type { NetworkId } from '@wetdrool/protocol';

import {
  MemoryProjectionStore,
  PostgresProjectionStore,
  protocolEventSchema,
  SOCIAL_PROTOCOL_EVENT_LAYOUT,
  type ProjectionStore,
  type ProtocolEvent,
} from '../src/index.js';
import { migrate } from '../src/migrate.js';

const databaseUrl =
  process.env['INDEXER_INTEGRATION_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgresql://wetdrool_indexer_runtime:local-indexer-runtime-only@127.0.0.1:5432/wetdrool';
const migrationDatabaseUrl =
  process.env['INDEXER_INTEGRATION_DATABASE_MIGRATION_URL'] ??
  process.env['DATABASE_MIGRATION_URL'] ??
  'postgresql://wetdrool_indexer_migration:local-indexer-migration-only@127.0.0.1:5432/wetdrool';

describe('PostgreSQL identity deactivation integration', () => {
  it('matches memory projection, survives rebuild, and keeps historical authorization', async () => {
    await migrate(migrationDatabaseUrl);
    const programId = SOCIAL_PROTOCOL_EVENT_LAYOUT.programId;
    const networkId = `droolnet:v1:${publicKey()}:${programId}` as NetworkId;
    const configAddress = publicKey();
    const identityAddress = publicKey();
    const identityId = `wetdroolid:v1:${networkId}:${identityAddress}`;
    const rootAuthority = publicKey();
    const delegateAuthority = publicKey();
    const nextRootAuthority = publicKey();
    const base = (slot: bigint, logIndex = 0) => ({
      networkId,
      programId,
      transactionSignature: bs58.encode(randomBytes(64)),
      transactionIndex: Number(slot),
      slot,
      logIndex,
      blockTime: new Date(Date.UTC(2026, 6, 28, 12, 0, Number(slot))).toISOString(),
      finalized: true as const,
    });
    const events: readonly ProtocolEvent[] = [
      protocolEventSchema.parse({
        ...base(1n),
        type: 'protocol-initialized',
        configAddress,
      }),
      protocolEventSchema.parse({
        ...base(2n),
        type: 'identity-created',
        identityId,
        identityAddress,
        rootAuthority,
      }),
      protocolEventSchema.parse({
        ...base(3n),
        type: 'delegation-created',
        identityId,
        delegationAddress: publicKey(),
        delegateAuthority,
        delegationSequence: 1n,
        identitySequence: 1n,
        scopes: 3,
        issuedAtRootRotationCount: 0n,
        expiresAtSlot: 100n,
      }),
      protocolEventSchema.parse({
        ...base(4n),
        type: 'identity-deactivated',
        configAddress,
        identityId,
        identityAddress,
        rootAuthority,
        identitySequence: 2n,
      }),
    ];
    const memory = new MemoryProjectionStore();
    const projected = new PostgresProjectionStore(databaseUrl);
    const inspection = postgres(databaseUrl, { max: 1 });

    try {
      await projected.clearProjection(networkId);
      for (const event of events) {
        await expect(memory.apply(event)).resolves.toBe(true);
        await expect(projected.apply(event)).resolves.toBe(true);
      }
      await expect(projected.getIdentity(identityId)).resolves.toEqual(
        await memory.getIdentity(identityId),
      );

      for (const projection of [memory, projected]) {
        await expect(
          authorize(projection, identityId, rootAuthority, 'root', events[2] as ProtocolEvent),
        ).resolves.toBe(true);
        await expect(
          authorize(
            projection,
            identityId,
            delegateAuthority,
            'delegation',
            events[2] as ProtocolEvent,
          ),
        ).resolves.toBe(true);
        await expect(
          authorize(projection, identityId, rootAuthority, 'root', events[3] as ProtocolEvent),
        ).resolves.toBe(false);
        await expect(
          projection.apply({
            ...base(5n),
            type: 'root-authority-rotated',
            identityId,
            previousRootAuthority: rootAuthority,
            newRootAuthority: nextRootAuthority,
            identitySequence: 3n,
            rotationCount: 1n,
          }),
        ).rejects.toThrow('inactive');
      }

      const rows = await inspection<
        {
          active: boolean;
          identity_sequence: string;
          deactivated_slot: string;
          deactivated_transaction_index: number | null;
          deactivated_transaction_signature: string;
          deactivated_log_index: number;
        }[]
      >`
        SELECT
          active,
          identity_sequence::text,
          deactivated_slot::text,
          deactivated_transaction_index,
          deactivated_transaction_signature,
          deactivated_log_index
        FROM identities
        WHERE network_id = ${networkId}
          AND identity_id = ${identityId}
      `;
      expect(rows).toEqual([
        {
          active: false,
          identity_sequence: '2',
          deactivated_slot: '4',
          deactivated_transaction_index: 4,
          deactivated_transaction_signature: events[3]?.transactionSignature,
          deactivated_log_index: 0,
        },
      ]);

      await projected.rebuildProjection(
        networkId,
        [...events].reverse().map((event) => ({ event })),
      );
      await expect(projected.getIdentity(identityId)).resolves.toEqual(
        await memory.getIdentity(identityId),
      );
      await expect(
        authorize(projected, identityId, rootAuthority, 'root', events[2] as ProtocolEvent),
      ).resolves.toBe(true);
      await expect(
        authorize(projected, identityId, rootAuthority, 'root', events[3] as ProtocolEvent),
      ).resolves.toBe(false);
    } finally {
      await projected.clearProjection(networkId);
      await projected.close();
      await inspection.end({ timeout: 5 });
    }
  });
});

function authorize(
  projection: ProjectionStore,
  identityId: string,
  authority: string,
  kind: 'root' | 'delegation',
  event: ProtocolEvent,
): Promise<boolean> {
  return projection.authorizeSigningKey({
    identityId,
    authority,
    kind,
    objectType: 'post',
    slot: event.slot,
    ...(event.transactionIndex === undefined ? {} : { transactionIndex: event.transactionIndex }),
    transactionSignature: event.transactionSignature,
    logIndex: event.logIndex,
  });
}

function publicKey(): string {
  return bs58.encode(randomBytes(32));
}
