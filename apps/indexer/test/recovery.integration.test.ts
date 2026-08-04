import { randomBytes } from 'node:crypto';

import bs58 from 'bs58';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import type { NetworkId } from '@wetdrool/protocol';
import { MemoryContentAddressedStorage } from '@wetdrool/storage';

import {
  deriveRecoveryPolicyAddress,
  deriveRecoveryRequestAddress,
  ManifestVerifier,
  OpenIndexer,
  PostgresProjectionStore,
  SOCIAL_PROTOCOL_EVENT_LAYOUT,
  type ProtocolEvent,
  type RecoveryApprovedEvent,
  type RecoveryExecutedEvent,
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

describe('PostgreSQL recovery projection integration', () => {
  it('rolls back invalid transitions and deterministically rebuilds policy and request state', async () => {
    await migrate(migrationDatabaseUrl);
    const fixture = await recoveryFixture();
    const secondNetworkId =
      `droolnet:v1:${publicKey()}:${SOCIAL_PROTOCOL_EVENT_LAYOUT.programId}` as NetworkId;
    const projection = new PostgresProjectionStore(databaseUrl);
    const inspectionSql = postgres(databaseUrl, { max: 1 });
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(new MemoryContentAddressedStorage(), {
        authorize: () => Promise.resolve(false),
      }),
    );

    try {
      await projection.clearProjection(fixture.networkId);
      for (const event of fixture.events.slice(0, 4)) {
        await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
      }

      const approval = fixture.events[4] as RecoveryApprovedEvent;
      await expect(
        indexer.ingest({
          ...approval,
          transactionSignature: signature(),
          guardian: fixture.guardians[2],
        }),
      ).rejects.toMatchObject({ code: 'stale-event' });
      await expect(projection.checkpoint(fixture.networkId)).resolves.toBe(4n);
      await expect(
        projection.getRecoveryRequest(fixture.networkId, fixture.recoveryRequestAddress),
      ).resolves.toMatchObject({
        approvalCount: 1,
        approvalsMask: 1,
        state: 'pending',
      });

      await expect(indexer.ingest(approval)).resolves.toMatchObject({ applied: true });
      await expect(
        indexer.ingest(fixture.events[6] as RecoveryExecutedEvent),
      ).rejects.toMatchObject({ code: 'stale-event' });
      await expect(projection.checkpoint(fixture.networkId)).resolves.toBe(5n);
      await expect(
        projection.getRecoveryRequest(fixture.networkId, fixture.recoveryRequestAddress),
      ).resolves.toMatchObject({
        approvalCount: 2,
        state: 'pending',
      });

      for (const event of fixture.events.slice(5)) {
        await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
      }
      await expect(indexer.ingest(fixture.events.at(-1) as ProtocolEvent)).resolves.toMatchObject({
        applied: false,
      });

      const expected = stableJson({
        policy: await projection.getRecoveryPolicy(fixture.identityId),
        requests: await projection.getRecoveryRequestsByIdentity(fixture.identityId),
        checkpoint: await projection.checkpoint(fixture.networkId),
      });
      expect(expected).toContain('"policySequence":"3"');
      expect(expected).toContain('"state":"executed"');
      expect(expected).toContain('"state":"cancelled"');

      const rawBeforeFailedRebuild = await inspectionSql`
        SELECT
          network_id,
          transaction_signature,
          transaction_index,
          slot::text AS slot,
          log_index,
          block_time::text AS block_time,
          event_type,
          event_body::text AS event_body,
          ingested_at::text AS ingested_at
        FROM protocol_events
        WHERE network_id = ${fixture.networkId}
        ORDER BY slot, transaction_index NULLS LAST, transaction_signature, log_index
      `;
      const projectionBeforeFailedRebuild = expected;
      const invalidLateApproval: RecoveryApprovedEvent = {
        ...(fixture.events[4] as RecoveryApprovedEvent),
        transactionSignature: signature(),
        transactionIndex: 1_000,
        slot: 11n,
        blockTime: new Date(Date.UTC(2026, 6, 28, 19, 0, 11)).toISOString(),
        approvalCount: 3,
      };
      await expect(
        indexer.rebuild(fixture.networkId, [...fixture.events, invalidLateApproval]),
      ).rejects.toBeInstanceOf(Error);
      const rawAfterFailedRebuild = await inspectionSql`
        SELECT
          network_id,
          transaction_signature,
          transaction_index,
          slot::text AS slot,
          log_index,
          block_time::text AS block_time,
          event_type,
          event_body::text AS event_body,
          ingested_at::text AS ingested_at
        FROM protocol_events
        WHERE network_id = ${fixture.networkId}
        ORDER BY slot, transaction_index NULLS LAST, transaction_signature, log_index
      `;
      expect(stableJson(rawAfterFailedRebuild)).toBe(stableJson(rawBeforeFailedRebuild));
      expect(
        stableJson({
          policy: await projection.getRecoveryPolicy(fixture.identityId),
          requests: await projection.getRecoveryRequestsByIdentity(fixture.identityId),
          checkpoint: await projection.checkpoint(fixture.networkId),
        }),
      ).toBe(projectionBeforeFailedRebuild);

      const rebuilt = await indexer.rebuild(fixture.networkId, [...fixture.events].reverse());
      expect(rebuilt).toHaveLength(fixture.events.length);
      const actual = stableJson({
        policy: await projection.getRecoveryPolicy(fixture.identityId),
        requests: await projection.getRecoveryRequestsByIdentity(fixture.identityId),
        checkpoint: await projection.checkpoint(fixture.networkId),
      });
      expect(actual).toBe(expected);

      for (const event of fixture.events.map((item) =>
        moveEventToNetwork(item, fixture.networkId, secondNetworkId),
      )) {
        await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
      }
      const secondIdentityId = fixture.identityId.replace(fixture.networkId, secondNetworkId);
      await expect(projection.getRecoveryPolicy(fixture.identityId)).resolves.toMatchObject({
        networkId: fixture.networkId,
      });
      await expect(projection.getRecoveryPolicy(secondIdentityId)).resolves.toMatchObject({
        networkId: secondNetworkId,
      });
      await expect(
        projection.getRecoveryRequest(fixture.networkId, fixture.recoveryRequestAddress),
      ).resolves.toMatchObject({
        networkId: fixture.networkId,
        state: 'executed',
      });
      await expect(
        projection.getRecoveryRequest(secondNetworkId, fixture.recoveryRequestAddress),
      ).resolves.toMatchObject({
        networkId: secondNetworkId,
        state: 'executed',
      });
    } finally {
      await projection.clearProjection(fixture.networkId);
      await projection.clearProjection(secondNetworkId);
      await projection.close();
      await inspectionSql.end({ timeout: 5 });
    }
  });
});

async function recoveryFixture() {
  const programId = SOCIAL_PROTOCOL_EVENT_LAYOUT.programId;
  const networkId = `droolnet:v1:${publicKey()}:${programId}` as NetworkId;
  const configAddress = publicKey();
  const identityAddress = publicKey();
  const identityId = `wetdroolid:v1:${networkId}:${identityAddress}`;
  const originalRoot = publicKey();
  const recoveredRoot = publicKey();
  const secondTargetRoot = publicKey();
  const executor = publicKey();
  const guardians = [publicKey(), publicKey(), publicKey()] as const;
  const requestNonce = randomBytes(16);
  const secondRequestNonce = randomBytes(16);
  const requestNonceHex = requestNonce.toString('hex');
  const secondRequestNonceHex = secondRequestNonce.toString('hex');
  const recoveryPolicyAddress = await deriveRecoveryPolicyAddress(programId, identityAddress);
  const recoveryRequestAddress = await deriveRecoveryRequestAddress(
    programId,
    identityAddress,
    requestNonce,
  );
  const secondRecoveryRequestAddress = await deriveRecoveryRequestAddress(
    programId,
    identityAddress,
    secondRequestNonce,
  );
  let transactionIndex = 0;
  const eventBase = (slot: bigint) => ({
    networkId,
    programId,
    transactionSignature: signature(),
    transactionIndex: transactionIndex++,
    slot,
    logIndex: 0,
    blockTime: new Date(Date.UTC(2026, 6, 28, 19, 0, Number(slot))).toISOString(),
    finalized: true as const,
  });
  const executionSignature = signature();
  const executionTransactionIndex = transactionIndex++;
  const executionBase = {
    networkId,
    programId,
    transactionSignature: executionSignature,
    transactionIndex: executionTransactionIndex,
    slot: 6n,
    blockTime: new Date(Date.UTC(2026, 6, 28, 19, 0, 6)).toISOString(),
    finalized: true as const,
  };
  const events: readonly ProtocolEvent[] = [
    {
      ...eventBase(1n),
      type: 'protocol-initialized',
      configAddress,
    },
    {
      ...eventBase(2n),
      type: 'identity-created',
      identityId,
      identityAddress,
      rootAuthority: originalRoot,
    },
    {
      ...eventBase(3n),
      type: 'recovery-policy-configured',
      identityId,
      recoveryPolicyAddress,
      rootAuthority: originalRoot,
      policySequence: 1n,
      identitySequence: 1n,
      rootRotationCount: 0n,
      guardians: [...guardians],
      threshold: 2,
      delaySlots: 2n,
    },
    {
      ...eventBase(4n),
      type: 'recovery-requested',
      identityId,
      recoveryPolicyAddress,
      recoveryRequestAddress,
      requestingGuardian: guardians[0],
      requestNonce: requestNonceHex,
      policySequence: 1n,
      currentRootAuthority: originalRoot,
      identitySequence: 1n,
      rootRotationCount: 0n,
      targetRootAuthority: recoveredRoot,
      threshold: 2,
      guardianCount: 3,
      approvalCount: 1,
      executeAfterSlot: 6n,
    },
    {
      ...eventBase(5n),
      type: 'recovery-approved',
      identityId,
      recoveryPolicyAddress,
      recoveryRequestAddress,
      guardian: guardians[1],
      guardianIndex: 1,
      policySequence: 1n,
      approvalCount: 2,
      threshold: 2,
    },
    {
      ...executionBase,
      logIndex: 0,
      type: 'root-authority-rotated',
      identityId,
      previousRootAuthority: originalRoot,
      newRootAuthority: recoveredRoot,
      identitySequence: 2n,
      rotationCount: 1n,
    },
    {
      ...executionBase,
      logIndex: 1,
      type: 'recovery-executed',
      identityId,
      recoveryPolicyAddress,
      recoveryRequestAddress,
      executor,
      previousRootAuthority: originalRoot,
      newRootAuthority: recoveredRoot,
      policySequence: 1n,
      approvalCount: 2,
      threshold: 2,
      identitySequence: 2n,
      rotationCount: 1n,
    },
    {
      ...eventBase(7n),
      type: 'recovery-policy-configured',
      identityId,
      recoveryPolicyAddress,
      rootAuthority: recoveredRoot,
      policySequence: 2n,
      identitySequence: 3n,
      rootRotationCount: 1n,
      guardians: [...guardians],
      threshold: 2,
      delaySlots: 2n,
    },
    {
      ...eventBase(8n),
      type: 'recovery-requested',
      identityId,
      recoveryPolicyAddress,
      recoveryRequestAddress: secondRecoveryRequestAddress,
      requestingGuardian: guardians[0],
      requestNonce: secondRequestNonceHex,
      policySequence: 2n,
      currentRootAuthority: recoveredRoot,
      identitySequence: 3n,
      rootRotationCount: 1n,
      targetRootAuthority: secondTargetRoot,
      threshold: 2,
      guardianCount: 3,
      approvalCount: 1,
      executeAfterSlot: 10n,
    },
    {
      ...eventBase(9n),
      type: 'recovery-cancelled',
      identityId,
      recoveryPolicyAddress,
      recoveryRequestAddress: secondRecoveryRequestAddress,
      cancelledByRootAuthority: recoveredRoot,
      targetRootAuthority: secondTargetRoot,
      policySequence: 2n,
      identitySequence: 4n,
      rootRotationCount: 1n,
    },
    {
      ...eventBase(10n),
      type: 'recovery-policy-disabled',
      identityId,
      recoveryPolicyAddress,
      rootAuthority: recoveredRoot,
      policySequence: 3n,
      identitySequence: 5n,
      rootRotationCount: 1n,
    },
  ];
  return {
    networkId,
    identityId,
    recoveryRequestAddress,
    guardians,
    events,
  };
}

function publicKey(): string {
  return bs58.encode(randomBytes(32));
}

function signature(): string {
  return bs58.encode(randomBytes(64));
}

function moveEventToNetwork(
  event: ProtocolEvent,
  sourceNetworkId: NetworkId,
  targetNetworkId: NetworkId,
): ProtocolEvent {
  return Object.fromEntries(
    Object.entries(event).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.replace(sourceNetworkId, targetNetworkId) : value,
    ]),
  ) as unknown as ProtocolEvent;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}
