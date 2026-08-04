import { randomBytes } from 'node:crypto';

import bs58 from 'bs58';
import postgres, { type Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  communityGovernanceStrategyCommitment,
  encodeMultibaseBase64Url,
  WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  type CommunityContent,
  type NetworkId,
  type PostContent,
  type ProfileContent,
} from '@wetdrool/protocol';

import {
  MemoryProjectionStore,
  PostgresProjectionStore,
  type ManifestDeferral,
  type ProtocolEvent,
  type TerminalManifestRejection,
  type VerifiedManifest,
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
const programId = publicKey(2);
const retryAt = '2026-07-28T12:05:00.000Z';

describe('PostgreSQL pending manifest ingestion state', () => {
  it('hydrates community shells, preserves immutable governance proof, and rebuilds discovery', async () => {
    await migrate(migrationDatabaseUrl);
    const fixture = identityFixture();
    const projection = new PostgresProjectionStore(databaseUrl);
    const maintenance = postgres(migrationDatabaseUrl, { max: 1 });
    const created = identityCreated(fixture);
    const pending = communityItem(fixture, 1n, 2n, 80, 'public');
    const updatedStrategy = digest(81);
    const currentAuthority = publicKey(84);
    const governanceUpdated: ProtocolEvent = {
      ...eventBase(fixture.networkId, 3n, 81),
      type: 'community-governance-updated',
      communityAddress: pending.event.communityAddress,
      creatorIdentityId: fixture.identityId,
      authority: currentAuthority,
      creatorSequence: 2n,
      previousGovernanceVersion: 1,
      governanceVersion: 2,
      previousStrategyHash: pending.event.governanceStrategyHash,
      governanceStrategyHash: updatedStrategy,
    };

    try {
      await projection.apply(created);
      await projection.deferManifestEvent(pending.event, deferral());
      await expect(
        projection.duePendingManifestEvents(fixture.networkId, retryAt, 10),
      ).resolves.toMatchObject([{ event: { type: 'community-created', creatorSequence: 1n } }]);
      await expect(
        projection.getCommunity(fixture.networkId, pending.event.communityAddress),
      ).resolves.toMatchObject({ manifestVerified: false });
      await expect(
        projection.listPublicCommunities({ networkId: fixture.networkId, limit: 10 }),
      ).resolves.toMatchObject({ communities: [] });

      await projection.promoteManifestEvent(pending.event, pending.manifest);
      await projection.apply(governanceUpdated);
      await expect(
        projection.getCommunity(fixture.networkId, pending.event.communityAddress),
      ).resolves.toMatchObject({
        manifestVerified: true,
        manifestAuthority: fixture.rootAuthority,
        latestActionAuthority: currentAuthority,
        signingKeyId: `${fixture.identityId}#root/${fixture.rootAuthority}`,
        manifestGovernanceVersion: 1,
        manifestGovernanceStrategyHash: pending.event.governanceStrategyHash,
        governanceVersion: 2,
        governanceStrategyHash: updatedStrategy,
        content: { name: 'Community 80' },
      });
      await expect(
        projection.listPublicCommunities({ networkId: fixture.networkId, limit: 10 }),
      ).resolves.toMatchObject({
        communities: [{ communityAddress: pending.event.communityAddress }],
      });
      await expect(
        maintenance`
          UPDATE communities
          SET
            governance_version = manifest_governance_version,
            governance_strategy_hash = ${updatedStrategy}
          WHERE network_id = ${fixture.networkId}
            AND community_address = ${pending.event.communityAddress}
        `,
      ).rejects.toThrow('communities_governance_advances_manifest_check');
      await expect(
        maintenance`
          UPDATE communities
          SET manifest_authority = ${currentAuthority}
          WHERE network_id = ${fixture.networkId}
            AND community_address = ${pending.event.communityAddress}
        `,
      ).rejects.toThrow('communities_manifest_binding_check');

      await projection.rebuildProjection(fixture.networkId, [
        { event: created },
        { event: pending.event, manifest: pending.manifest },
        { event: governanceUpdated },
      ]);
      await expect(
        projection.listPublicCommunities({ networkId: fixture.networkId, limit: 10 }),
      ).resolves.toMatchObject({
        communities: [
          {
            manifestAuthority: fixture.rootAuthority,
            latestActionAuthority: currentAuthority,
            manifestGovernanceVersion: 1,
            governanceVersion: 2,
            content: { name: 'Community 80' },
          },
        ],
      });
    } finally {
      await projection.clearProjection(fixture.networkId).catch(() => undefined);
      await purgeRawNetwork(maintenance, fixture.networkId);
      await Promise.all([projection.close(), maintenance.end({ timeout: 5 })]);
    }
  }, 30_000);

  it('paginates equal-slot mixed-case community addresses with PostgreSQL C ordering', async () => {
    await migrate(migrationDatabaseUrl);
    const fixture = identityFixture();
    const projection = new PostgresProjectionStore(databaseUrl);
    const maintenance = postgres(migrationDatabaseUrl, { max: 1 });
    const writer = postgres(migrationDatabaseUrl, { max: 1 });
    const inspection = postgres(databaseUrl, { max: 1 });
    const writerReady = deferred();
    const releaseWriter = deferred();
    let pendingWriter: Promise<unknown> | undefined;
    const rawHigherAddress = publicKey(1);
    const rawLowerAddress = publicKey(52);
    const changedAuthority = publicKey(85);
    const first = communityItem(fixture, 1n, 2n, 82, 'public');
    const second = communityItem(fixture, 2n, 2n, 83, 'public');
    const firstEvent: ProtocolEvent = {
      ...first.event,
      communityAddress: rawHigherAddress,
      transactionIndex: 0,
    };
    const secondEvent: ProtocolEvent = {
      ...second.event,
      communityAddress: rawLowerAddress,
      transactionIndex: 1,
    };

    expect(rawHigherAddress).toMatch(/[A-Z]/u);
    expect(rawHigherAddress).toMatch(/[a-z]/u);
    expect(rawLowerAddress).toMatch(/[A-Z]/u);
    expect(rawLowerAddress).toMatch(/[a-z]/u);
    expect(rawHigherAddress > rawLowerAddress).toBe(true);

    try {
      await projection.apply(identityCreated(fixture));
      await projection.apply(firstEvent, first.manifest);
      await projection.apply(secondEvent, second.manifest);

      const firstPage = await projection.listPublicCommunities({
        networkId: fixture.networkId,
        limit: 1,
      });
      expect(firstPage).toMatchObject({
        communities: [{ communityAddress: rawHigherAddress }],
        next: { createdSlot: 2n, communityAddress: rawHigherAddress },
      });
      if (firstPage.next === undefined) throw new Error('Expected a second directory page.');
      await expect(
        projection.listPublicCommunities({
          networkId: fixture.networkId,
          limit: 1,
          before: firstPage.next,
        }),
      ).resolves.toMatchObject({
        communities: [{ communityAddress: rawLowerAddress }],
      });

      pendingWriter = writer.begin(async (sql) => {
        await sql.unsafe('LOCK TABLE indexer_checkpoints IN ACCESS EXCLUSIVE MODE');
        await sql`
          UPDATE communities
          SET
            latest_action_authority = ${changedAuthority},
            updated_slot = 3,
            updated_at = '2026-07-28T12:00:03.000Z'
          WHERE network_id = ${fixture.networkId}
        `;
        await sql`
          UPDATE indexer_checkpoints
          SET
            finalized_slot = 3,
            transaction_signature = 'directory-snapshot-three',
            log_index = 0
          WHERE network_id = ${fixture.networkId}
        `;
        writerReady.resolve();
        await releaseWriter.promise;
      });
      await writerReady.promise;

      const duringCommit = projection.listPublicCommunities({
        networkId: fixture.networkId,
        limit: 10,
      });
      await waitForBlockedDirectoryCheckpoint(inspection);
      releaseWriter.resolve();
      await pendingWriter;

      await expect(duringCommit).resolves.toMatchObject({
        checkpoint: 2n,
        communities: [
          { communityAddress: rawHigherAddress, latestActionAuthority: fixture.rootAuthority },
          { communityAddress: rawLowerAddress, latestActionAuthority: fixture.rootAuthority },
        ],
      });
      await expect(
        projection.listPublicCommunities({ networkId: fixture.networkId, limit: 10 }),
      ).resolves.toMatchObject({
        checkpoint: 3n,
        communities: [
          { communityAddress: rawHigherAddress, latestActionAuthority: changedAuthority },
          { communityAddress: rawLowerAddress, latestActionAuthority: changedAuthority },
        ],
      });
    } finally {
      releaseWriter.resolve();
      await pendingWriter?.catch(() => undefined);
      await projection.clearProjection(fixture.networkId).catch(() => undefined);
      await purgeRawNetwork(maintenance, fixture.networkId);
      await Promise.all([
        projection.close(),
        maintenance.end({ timeout: 5 }),
        writer.end({ timeout: 5 }),
        inspection.end({ timeout: 5 }),
      ]);
    }
  }, 30_000);

  it('promotes without replaying sequence and preserves superseding profiles and tombstones', async () => {
    await migrate(migrationDatabaseUrl);
    const fixture = identityFixture();
    const projection = new PostgresProjectionStore(databaseUrl);
    const maintenance = postgres(migrationDatabaseUrl, { max: 1 });
    const created = identityCreated(fixture);
    const current = profileItem(fixture, 1n, 2n, 10, 'Current profile');
    const pendingProfile = profileItem(fixture, 2n, 3n, 11, 'Pending profile');
    const latest = profileItem(fixture, 3n, 4n, 12, 'Latest profile');
    const pendingPost = postItem(fixture, 4n, 5n, 13, 'Unavailable post');
    const tombstone: ProtocolEvent = {
      ...eventBase(fixture.networkId, 6n, 14),
      type: 'tombstoned',
      identityId: fixture.identityId,
      targetPostReference: pendingPost.event.postReference,
      targetObjectId: pendingPost.event.objectId,
      sequence: 5n,
    };

    try {
      await projection.apply(created);
      await projection.apply(current.event, current.manifest);
      await expect(projection.deferManifestEvent(pendingProfile.event, deferral())).resolves.toBe(
        true,
      );
      await expect(projection.getProfile(fixture.identityId)).resolves.toBeUndefined();
      await expect(projection.getIdentity(fixture.identityId)).resolves.toMatchObject({
        identitySequence: 2n,
        updatedSlot: 3n,
      });
      await expect(projection.checkpoint(fixture.networkId)).resolves.toBe(3n);
      await expect(projection.manifestEventDisposition(pendingProfile.event)).resolves.toEqual({
        state: 'pending',
      });
      await expect(
        projection.duePendingManifestEvents(fixture.networkId, '2026-07-28T12:04:59.999Z', 10),
      ).resolves.toEqual([]);
      await expect(
        projection.duePendingManifestEvents(fixture.networkId, retryAt, 1),
      ).resolves.toEqual([
        {
          event: pendingProfile.event,
          attempts: 1,
          eventBody: { encodedData: 'temporarily-unavailable' },
          failureDetail: 'Manifest content is temporarily unavailable.',
          nextAttemptAt: retryAt,
        },
      ]);
      await expect(
        projection.deadLetter(
          fixture.networkId,
          pendingProfile.event.transactionSignature,
          pendingProfile.event.logIndex,
        ),
      ).resolves.toEqual({ attempts: 1, nextAttemptAt: retryAt });
      await expect(projection.deferManifestEvent(pendingProfile.event, deferral())).resolves.toBe(
        false,
      );

      await projection.apply(latest.event, latest.manifest);
      await expect(
        projection.promoteManifestEvent(pendingProfile.event, pendingProfile.manifest),
      ).resolves.toBe(true);
      await expect(projection.getProfile(fixture.identityId)).resolves.toMatchObject({
        objectId: latest.event.objectId,
        content: { displayName: 'Latest profile' },
      });
      await expect(projection.getIdentity(fixture.identityId)).resolves.toMatchObject({
        identitySequence: 3n,
      });
      await expect(projection.manifestEventDisposition(pendingProfile.event)).resolves.toEqual({
        state: 'accepted',
      });
      await expect(
        projection.deadLetter(
          fixture.networkId,
          pendingProfile.event.transactionSignature,
          pendingProfile.event.logIndex,
        ),
      ).resolves.toBeUndefined();
      await expect(
        projection.reschedulePendingManifestEvent(pendingProfile.event, {
          ...deferral(),
          nextAttemptAt: '2026-07-28T12:06:00.000Z',
        }),
      ).resolves.toBeUndefined();
      await expect(
        maintenance`
          INSERT INTO indexer_dead_letters (
            network_id, transaction_signature, log_index, event_body,
            failure_code, failure_detail, next_attempt_at
          ) VALUES (
            ${fixture.networkId}, ${pendingProfile.event.transactionSignature},
            ${pendingProfile.event.logIndex}, '{}'::jsonb,
            'manifest-unavailable', 'simulated retry-after-promotion race',
            '2026-07-28T12:06:00.000Z'
          )
        `,
      ).rejects.toThrow(
        'retryable manifest-unavailable dead letter requires an exactly matching pending raw event',
      );

      await projection.deferManifestEvent(pendingPost.event, deferral());
      await expect(projection.getPost(pendingPost.event.objectId)).resolves.toBeUndefined();
      await expect(
        projection.findPostObjectIdByReference(fixture.networkId, pendingPost.event.postReference),
      ).resolves.toBe(pendingPost.event.objectId);
      await projection.apply(tombstone);

      await projection.rebuildProjection(fixture.networkId, [
        { event: created },
        { event: current.event, manifest: current.manifest },
        { event: pendingProfile.event, manifest: pendingProfile.manifest },
        { event: latest.event, manifest: latest.manifest },
        { event: pendingPost.event, pendingManifest: deferral() },
        { event: tombstone },
      ]);
      await expect(
        projection.promoteManifestEvent(pendingPost.event, pendingPost.manifest),
      ).resolves.toBe(true);
      await expect(projection.getPost(pendingPost.event.objectId)).resolves.toMatchObject({
        tombstonedAt: tombstone.blockTime,
      });
      await expect(
        projection.getFeed({ networkId: fixture.networkId, mode: 'chronological', limit: 20 }),
      ).resolves.toEqual([]);
      await expect(projection.getIdentity(fixture.identityId)).resolves.toMatchObject({
        identitySequence: 5n,
      });
      await expect(projection.checkpoint(fixture.networkId)).resolves.toBe(6n);

      const acceptedReplayPrefix = [
        { event: created },
        { event: current.event, manifest: current.manifest },
        { event: pendingProfile.event, manifest: pendingProfile.manifest },
        { event: latest.event, manifest: latest.manifest },
      ] as const;
      await expect(
        projection.rebuildProjection(fixture.networkId, [
          ...acceptedReplayPrefix,
          {
            event: pendingPost.event,
            acceptedManifestSuppression: {
              reason: 'later-profile-pointer',
              suppressorTransactionSignature: tombstone.transactionSignature,
              suppressorLogIndex: tombstone.logIndex,
            },
          },
          { event: tombstone },
        ]),
      ).rejects.toMatchObject({ code: 'event-conflict' });

      await expect(
        projection.rebuildProjection(fixture.networkId, [
          ...acceptedReplayPrefix,
          {
            event: pendingPost.event,
            acceptedManifestSuppression: {
              reason: 'later-tombstone',
              suppressorTransactionSignature: tombstone.transactionSignature,
              suppressorLogIndex: tombstone.logIndex,
            },
          },
          { event: tombstone },
        ]),
      ).resolves.toBeUndefined();
      await expect(projection.getPost(pendingPost.event.objectId)).resolves.toBeUndefined();
      await expect(
        projection.findPostObjectIdByReference(fixture.networkId, pendingPost.event.postReference),
      ).resolves.toBe(pendingPost.event.objectId);
      await expect(projection.manifestEventDisposition(pendingPost.event)).resolves.toEqual({
        state: 'accepted',
      });
      await expect(projection.getIdentity(fixture.identityId)).resolves.toMatchObject({
        identitySequence: 5n,
      });
    } finally {
      await projection.clearProjection(fixture.networkId).catch(() => undefined);
      await purgeRawNetwork(maintenance, fixture.networkId);
      await Promise.all([projection.close(), maintenance.end({ timeout: 5 })]);
    }
  }, 30_000);

  it('makes pending-to-terminal exact and keeps the raw ledger insert-only for runtime', async () => {
    await migrate(migrationDatabaseUrl);
    const fixture = identityFixture();
    const projection = new PostgresProjectionStore(databaseUrl);
    const runtime = postgres(databaseUrl, { max: 1 });
    const maintenance = postgres(migrationDatabaseUrl, { max: 1 });
    const created = identityCreated(fixture);
    const pending = postItem(fixture, 1n, 2n, 30, 'Invalid after retrieval');
    const rejection: TerminalManifestRejection = {
      eventBody: { encodedData: 'terminal-after-retrieval' },
      failureCode: 'manifest-invalid',
      failureDetail: 'Retrieved bytes are not a canonical signed envelope.',
    };

    try {
      await projection.apply(created);
      await projection.deferManifestEvent(pending.event, deferral());

      await expect(
        projection.manifestEventDisposition({
          ...pending.event,
          blockTime: '2026-07-28T12:00:59.000Z',
        }),
      ).rejects.toMatchObject({ code: 'event-conflict' });
      const [wrongFingerprint] = await runtime<{ transitioned: boolean }[]>`
        SELECT accept_pending_manifest_event(
          ${pending.event.networkId},
          ${pending.event.transactionSignature},
          ${pending.event.transactionIndex ?? null},
          ${pending.event.logIndex},
          ${pending.event.slot.toString()},
          ${pending.event.blockTime},
          ${pending.event.type},
          ${runtime.json({ forged: true })}
        ) AS transitioned
      `;
      expect(wrongFingerprint?.transitioned).toBe(false);
      await expect(projection.manifestEventDisposition(pending.event)).resolves.toEqual({
        state: 'pending',
      });

      await expect(projection.rejectPendingManifestEvent(pending.event, rejection)).resolves.toBe(
        true,
      );
      await expect(projection.manifestEventDisposition(pending.event)).resolves.toEqual({
        state: 'terminal',
        failureCode: 'manifest-invalid',
      });
      await expect(projection.getIdentity(fixture.identityId)).resolves.toMatchObject({
        identitySequence: 1n,
        updatedSlot: 2n,
      });
      await expect(projection.checkpoint(fixture.networkId)).resolves.toBe(2n);
      await expect(
        projection.deadLetter(
          fixture.networkId,
          pending.event.transactionSignature,
          pending.event.logIndex,
        ),
      ).resolves.toEqual({
        attempts: 1,
        terminalFailureCode: 'manifest-invalid',
      });
      await expect(projection.rejectPendingManifestEvent(pending.event, rejection)).resolves.toBe(
        false,
      );
      await expect(
        projection.rejectPendingManifestEvent(pending.event, {
          ...rejection,
          failureCode: 'hash-mismatch',
        }),
      ).rejects.toMatchObject({ code: 'event-conflict' });
      await expect(
        projection.promoteManifestEvent(pending.event, pending.manifest),
      ).rejects.toMatchObject({ code: 'event-conflict' });

      await expect(
        runtime`
          UPDATE protocol_events
          SET event_body = '{"forged":true}'::jsonb
          WHERE network_id = ${fixture.networkId}
            AND transaction_signature = ${pending.event.transactionSignature}
            AND log_index = ${pending.event.logIndex}
        `,
      ).rejects.toThrow('permission denied');
      await expect(
        runtime`
          DELETE FROM protocol_events
          WHERE network_id = ${fixture.networkId}
            AND transaction_signature = ${pending.event.transactionSignature}
            AND log_index = ${pending.event.logIndex}
        `,
      ).rejects.toThrow('permission denied');
      await expect(
        runtime`
          INSERT INTO protocol_events (
            network_id, transaction_signature, transaction_index, log_index, slot,
            block_time, event_type, event_body, manifest_pending,
            terminal_manifest_failure_code
          ) VALUES (
            ${fixture.networkId}, ${pending.event.transactionSignature},
            ${pending.event.transactionIndex ?? null}, ${pending.event.logIndex},
            ${pending.event.slot.toString()}, ${pending.event.blockTime},
            ${pending.event.type}, '{"reinserted":true}'::jsonb, false, null
          )
        `,
      ).rejects.toThrow('duplicate key');
      await expect(
        maintenance`
          UPDATE protocol_events
          SET event_body = '{"operator_forgery":true}'::jsonb
          WHERE network_id = ${fixture.networkId}
            AND transaction_signature = ${pending.event.transactionSignature}
            AND log_index = ${pending.event.logIndex}
        `,
      ).rejects.toThrow('raw protocol event body and provenance are immutable');

      await expect(
        runtime`
          INSERT INTO indexer_dead_letters (
            network_id, transaction_signature, log_index, event_body,
            failure_code, failure_detail, next_attempt_at
          ) VALUES (
            ${fixture.networkId}, ${bs58.encode(randomBytes(64))}, 9, '{}'::jsonb,
            'manifest-invalid', 'forged terminal record', null
          )
        `,
      ).rejects.toThrow('exactly matching terminal raw protocol event');

      const beforeClear = await runtime<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM protocol_events
        WHERE network_id = ${fixture.networkId}
      `;
      await projection.clearProjection(fixture.networkId);
      const afterClear = await runtime<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM protocol_events
        WHERE network_id = ${fixture.networkId}
      `;
      expect(afterClear).toEqual(beforeClear);
      await expect(projection.getIdentity(fixture.identityId)).resolves.toBeUndefined();
    } finally {
      await projection.clearProjection(fixture.networkId).catch(() => undefined);
      await purgeRawNetwork(maintenance, fixture.networkId);
      await Promise.all([
        projection.close(),
        runtime.end({ timeout: 5 }),
        maintenance.end({ timeout: 5 }),
      ]);
    }
  }, 30_000);

  it('matches memory when a pending profile is promoted after identity deactivation', async () => {
    await migrate(migrationDatabaseUrl);
    const fixture = identityFixture();
    const memory = new MemoryProjectionStore();
    const projected = new PostgresProjectionStore(databaseUrl);
    const maintenance = postgres(migrationDatabaseUrl, { max: 1 });
    const configAddress = publicKey(71);
    const initialized: ProtocolEvent = {
      ...eventBase(fixture.networkId, 0n, 72),
      type: 'protocol-initialized',
      configAddress,
    };
    const created = identityCreated(fixture);
    const pending = profileItem(fixture, 1n, 2n, 73, 'Retained historical profile');
    const deactivated: ProtocolEvent = {
      ...eventBase(fixture.networkId, 3n, 74),
      type: 'identity-deactivated',
      configAddress,
      identityId: fixture.identityId,
      identityAddress: fixture.identityAddress,
      rootAuthority: fixture.rootAuthority,
      identitySequence: 2n,
    };
    const items = [
      { event: initialized },
      { event: created },
      { event: pending.event, manifest: pending.manifest },
      { event: deactivated },
    ] as const;

    try {
      for (const projection of [memory, projected]) {
        await projection.apply(initialized);
        await projection.apply(created);
        await projection.deferManifestEvent(pending.event, deferral());
        await projection.apply(deactivated);
        await expect(
          projection.promoteManifestEvent(pending.event, pending.manifest),
        ).resolves.toBe(true);
      }

      await expect(projected.getProfile(fixture.identityId)).resolves.toEqual(
        await memory.getProfile(fixture.identityId),
      );
      await expect(projected.getIdentity(fixture.identityId)).resolves.toEqual(
        await memory.getIdentity(fixture.identityId),
      );
      await expect(
        projected.searchPublic({
          networkId: fixture.networkId,
          term: 'Retained historical profile',
          limit: 10,
        }),
      ).resolves.toMatchObject({ results: [] });

      await memory.rebuildProjection(fixture.networkId, items);
      await projected.rebuildProjection(fixture.networkId, items);
      await expect(projected.getProfile(fixture.identityId)).resolves.toEqual(
        await memory.getProfile(fixture.identityId),
      );
      await expect(projected.getProfile(fixture.identityId)).resolves.toMatchObject({
        objectId: pending.event.objectId,
        content: { displayName: 'Retained historical profile' },
      });
      await expect(projected.getIdentity(fixture.identityId)).resolves.toMatchObject({
        active: false,
        identitySequence: 2n,
      });
    } finally {
      await projected.clearProjection(fixture.networkId).catch(() => undefined);
      await purgeRawNetwork(maintenance, fixture.networkId);
      await Promise.all([memory.close(), projected.close(), maintenance.end({ timeout: 5 })]);
    }
  }, 30_000);
});

interface IdentityFixture {
  readonly networkId: NetworkId;
  readonly identityId: string;
  readonly identityAddress: string;
  readonly rootAuthority: string;
}

function identityFixture(): IdentityFixture {
  const genesis = bs58.encode(randomBytes(32));
  const networkId = `droolnet:v1:${genesis}:${programId}` as NetworkId;
  const identityAddress = bs58.encode(randomBytes(32));
  return {
    networkId,
    identityAddress,
    identityId: `wetdroolid:v1:${networkId}:${identityAddress}`,
    rootAuthority: bs58.encode(randomBytes(32)),
  };
}

function identityCreated(fixture: IdentityFixture): ProtocolEvent {
  return {
    ...eventBase(fixture.networkId, 1n, 5),
    type: 'identity-created',
    identityId: fixture.identityId,
    identityAddress: fixture.identityAddress,
    rootAuthority: fixture.rootAuthority,
  };
}

function profileItem(
  fixture: IdentityFixture,
  sequence: bigint,
  slot: bigint,
  signatureSeed: number,
  displayName: string,
) {
  const event = {
    ...eventBase(fixture.networkId, slot, signatureSeed),
    type: 'profile-updated' as const,
    identityId: fixture.identityId,
    objectId: objectId('profile', signatureSeed),
    cid: cid(signatureSeed),
    payloadHash: digest(signatureSeed),
    sequence,
    profileSchemaVersion: 2 as const,
  };
  const content = {
    displayName,
    bio: '',
    pronouns: [],
    chosenFamilyLabels: [],
    links: [],
  } satisfies ProfileContent;
  return { event, manifest: manifest(event, 'profile', content) };
}

function postItem(
  fixture: IdentityFixture,
  sequence: bigint,
  slot: bigint,
  signatureSeed: number,
  body: string,
) {
  const event = {
    ...eventBase(fixture.networkId, slot, signatureSeed),
    type: 'post-published' as const,
    identityId: fixture.identityId,
    postReference: publicKey(signatureSeed + 80),
    objectId: objectId('post', signatureSeed),
    cid: cid(signatureSeed),
    payloadHash: digest(signatureSeed),
    sequence,
  };
  const content = {
    format: 'plain',
    body,
    media: [],
    language: 'en',
    contentWarnings: [],
    accessibility: {
      altTextReminderAcknowledged: false,
      captionReferences: [],
    },
    visibility: { kind: 'public' },
    authorLabels: [],
    replyPolicy: 'anyone',
    quotePolicy: 'allowed',
  } satisfies PostContent;
  return { event, manifest: manifest(event, 'post', content) };
}

function communityItem(
  fixture: IdentityFixture,
  sequence: bigint,
  slot: bigint,
  signatureSeed: number,
  visibility: Exclude<CommunityContent['visibility'], 'restricted'>,
) {
  const strategy = communityGovernanceStrategyCommitment({
    governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  });
  const event = {
    ...eventBase(fixture.networkId, slot, signatureSeed),
    type: 'community-created' as const,
    communityAddress: publicKey(signatureSeed + 90),
    creatorIdentityId: fixture.identityId,
    authority: fixture.rootAuthority,
    communityNonce: encodeMultibaseBase64Url(
      Uint8Array.from({ length: 16 }, (_, index) => signatureSeed + index),
    ),
    creatorSequence: sequence,
    manifestCid: cid(signatureSeed),
    manifestHash: digest(signatureSeed),
    governanceVersion: strategy.governanceVersion,
    governanceStrategyHash: strategy.digest,
    visibility,
    membershipPolicy: 'open' as const,
    membershipPolicySequence: 1n,
    membershipSequence: 0n,
  };
  const content = {
    slug: `community-${String(signatureSeed)}`,
    name: `Community ${String(signatureSeed)}`,
    description: 'A PostgreSQL hydration fixture.',
    visibility,
    membershipPolicy: 'open',
    governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
    federationPolicy: { mode: 'open', allow: [], block: [] },
    replacement: { sequence: 1 },
  } satisfies CommunityContent;
  return {
    event,
    manifest: {
      objectId: objectId('community', signatureSeed),
      cid: event.manifestCid,
      payloadHash: event.manifestHash,
      schemaVersion: 2 as const,
      signingKeyId: `${fixture.identityId}#root/${fixture.rootAuthority}`,
      authorIdentityId: fixture.identityId,
      createdAt: event.blockTime,
      type: 'community' as const,
      content,
    } satisfies VerifiedManifest,
  };
}

function manifest(
  event: Extract<ProtocolEvent, { type: 'profile-updated' | 'post-published' }>,
  type: 'profile' | 'post',
  content: ProfileContent | PostContent,
): VerifiedManifest {
  return {
    objectId: event.objectId,
    cid: event.cid as string,
    payloadHash: event.payloadHash,
    schemaVersion: type === 'profile' ? 2 : 1,
    signingKeyId: publicKey(70),
    authorIdentityId: event.identityId,
    createdAt: event.blockTime,
    type,
    content,
  };
}

function deferral(): ManifestDeferral {
  return {
    eventBody: { encodedData: 'temporarily-unavailable' },
    failureCode: 'manifest-unavailable',
    failureDetail: 'Manifest content is temporarily unavailable.',
    nextAttemptAt: retryAt,
  };
}

function eventBase(networkId: NetworkId, slot: bigint, signatureSeed: number) {
  return {
    networkId,
    programId,
    transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => signatureSeed)),
    transactionIndex: 0,
    slot,
    logIndex: 0,
    blockTime: new Date(Date.UTC(2026, 6, 28, 12, 0, Number(slot))).toISOString(),
    finalized: true as const,
  };
}

function digest(seed: number): string {
  return encodeMultibaseBase64Url(Uint8Array.from({ length: 32 }, () => seed));
}

function objectId(type: 'community' | 'profile' | 'post', seed: number): string {
  return `wetdroolobj:v1:${type}:${digest(seed)}`;
}

function cid(seed: number): string {
  void seed;
  return 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
}

function publicKey(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 32 }, () => seed));
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitForBlockedDirectoryCheckpoint(sql: Sql): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await sql<{ blocked: number }[]>`
      SELECT count(*)::integer AS blocked
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE '%FROM indexer_checkpoints%'
    `;
    if ((rows[0]?.blocked ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for a blocked community-directory checkpoint read.');
}

async function purgeRawNetwork(sql: Sql, networkId: NetworkId): Promise<void> {
  await sql.begin(async (transaction) => {
    await transaction`
      DELETE FROM indexer_dead_letters
      WHERE network_id = ${networkId}
    `;
    await transaction`
      DELETE FROM protocol_events
      WHERE network_id = ${networkId}
    `;
  });
}
