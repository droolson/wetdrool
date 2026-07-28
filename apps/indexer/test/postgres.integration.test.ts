import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  buildPostPayload,
  buildProfilePayload,
  buildTombstonePayload,
  canonicalizeEnvelope,
  createPayloadBuilderIdentity,
  encodeMultibaseBase64Url,
  getObjectId,
  signPayload,
  type NetworkId,
  type PortablePayload,
  type PostContent,
  type ProfileContent,
  type SignedEnvelope,
  type TombstoneContent,
} from '@wokesocial/protocol';
import { LocalContentAddressedStorage, type StorageReceipt } from '@wokesocial/storage';

import {
  ManifestVerifier,
  OpenIndexer,
  PostgresProjectionStore,
  type ProtocolEvent,
} from '../src/index.js';
import { migrate } from '../src/migrate.js';

const databaseUrl =
  process.env['INDEXER_INTEGRATION_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgresql://wokesocial:local-development-only@127.0.0.1:5432/wokesocial';
const programId = bs58.encode(Uint8Array.from({ length: 32 }, () => 8));

describe('PostgreSQL indexer integration', () => {
  it('distinguishes exact duplicates from conflicting immutable event coordinates', async () => {
    await migrate(databaseUrl);
    const networkId = `wokenet:v1:${bs58.encode(randomBytes(32))}:${programId}` as NetworkId;
    const identity = makeIdentity(networkId, 81);
    const projection = new PostgresProjectionStore(databaseUrl);
    const inspection = postgres(databaseUrl, { max: 1 });
    const signature = bs58.encode(randomBytes(64));
    const configAddress = bs58.encode(randomBytes(32));
    const first: ProtocolEvent = {
      ...eventBase(networkId, 1n, 81, '2026-07-28T13:00:00.000Z'),
      type: 'protocol-initialized',
      transactionSignature: signature,
      transactionIndex: 1,
      configAddress,
    };

    try {
      await projection.clearProjection(networkId);
      await expect(projection.apply(first)).resolves.toBe(true);
      await expect(projection.apply(first)).resolves.toBe(false);

      const conflicts: readonly ProtocolEvent[] = [
        { ...first, transactionIndex: 2 },
        { ...first, slot: 2n },
        { ...first, blockTime: '2026-07-28T13:00:01.000Z' },
        {
          networkId,
          programId,
          type: 'identity-created',
          transactionSignature: signature,
          transactionIndex: 1,
          slot: 1n,
          logIndex: 0,
          blockTime: '2026-07-28T13:00:00.000Z',
          finalized: true,
          identityId: identity.identityId,
          identityAddress: identity.identityAddress,
          rootAuthority: bs58.encode(identity.publicKey),
        },
        { ...first, configAddress: bs58.encode(randomBytes(32)) },
      ];
      for (const conflict of conflicts) {
        await expect(projection.apply(conflict)).rejects.toMatchObject({
          code: 'event-conflict',
        });
      }

      await expect(projection.getProtocolConfig(networkId)).resolves.toMatchObject({
        configAddress,
        initializedSlot: 1n,
      });
      const raw = await inspection<{ count: number; event_type: string }[]>`
        SELECT count(*)::integer AS count, min(event_type) AS event_type
        FROM protocol_events
        WHERE network_id = ${networkId}
      `;
      expect(raw).toEqual([{ count: 1, event_type: 'protocol-initialized' }]);
    } finally {
      await projection.clearProjection(networkId);
      await projection.close();
      await inspection.end({ timeout: 5 });
    }
  });

  it('serializes rebuild before a queued live apply without orphaning raw state', async () => {
    await migrate(databaseUrl);
    const networkId = `wokenet:v1:${bs58.encode(randomBytes(32))}:${programId}` as NetworkId;
    const identity = makeIdentity(networkId, 82);
    const projection = new PostgresProjectionStore(databaseUrl);
    const blocker = postgres(databaseUrl, { max: 1 });
    const inspection = postgres(databaseUrl, { max: 1 });
    const configEvent: ProtocolEvent = {
      ...eventBase(networkId, 1n, 82, '2026-07-28T13:00:00.000Z'),
      type: 'protocol-initialized',
      configAddress: bs58.encode(randomBytes(32)),
    };
    const liveIdentityEvent = identityEvent(identity, 2n, 83);
    const holderReady = deferred();
    const releaseHolder = deferred();
    let holder: Promise<unknown> | undefined;

    try {
      await projection.clearProjection(networkId);
      await projection.apply(configEvent);
      holder = blocker.begin(async (sql) => {
        await lockNetwork(sql, networkId);
        holderReady.resolve();
        await releaseHolder.promise;
      });
      await holderReady.promise;

      const rebuild = projection.rebuildProjection(networkId, [{ event: configEvent }]);
      await waitForAdvisoryWaiters(inspection, networkId, 1);
      const liveApply = projection.apply(liveIdentityEvent);
      await waitForAdvisoryWaiters(inspection, networkId, 2);
      releaseHolder.resolve();
      await holder;

      await expect(Promise.all([rebuild, liveApply])).resolves.toEqual([undefined, true]);
      await expect(projection.getIdentity(identity.identityId)).resolves.toMatchObject({
        identityId: identity.identityId,
        networkId,
      });
      const raw = await inspection<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM protocol_events
        WHERE network_id = ${networkId}
      `;
      expect(raw).toEqual([{ count: 2 }]);
    } finally {
      releaseHolder.resolve();
      await holder?.catch(() => undefined);
      await projection.clearProjection(networkId);
      await projection.close();
      await blocker.end({ timeout: 5 });
      await inspection.end({ timeout: 5 });
    }
  });

  it('allows mutations for different networks to proceed concurrently', async () => {
    await migrate(databaseUrl);
    const networkA = `wokenet:v1:${bs58.encode(randomBytes(32))}:${programId}` as NetworkId;
    const networkB = `wokenet:v1:${bs58.encode(randomBytes(32))}:${programId}` as NetworkId;
    const projection = new PostgresProjectionStore(databaseUrl);
    const blocker = postgres(databaseUrl, { max: 1 });
    const inspection = postgres(databaseUrl, { max: 1 });
    const eventA: ProtocolEvent = {
      ...eventBase(networkA, 1n, 84, '2026-07-28T13:00:00.000Z'),
      type: 'protocol-initialized',
      configAddress: bs58.encode(randomBytes(32)),
    };
    const eventB: ProtocolEvent = {
      ...eventBase(networkB, 1n, 85, '2026-07-28T13:00:00.000Z'),
      type: 'protocol-initialized',
      configAddress: bs58.encode(randomBytes(32)),
    };
    const holderReady = deferred();
    const releaseHolder = deferred();
    let holder: Promise<unknown> | undefined;
    let applyA: Promise<boolean> | undefined;
    let applyB: Promise<boolean> | undefined;

    try {
      await projection.clearProjection(networkA);
      await projection.clearProjection(networkB);
      holder = blocker.begin(async (sql) => {
        await lockNetwork(sql, networkA);
        holderReady.resolve();
        await releaseHolder.promise;
      });
      await holderReady.promise;

      applyA = projection.apply(eventA);
      await waitForAdvisoryWaiters(inspection, networkA, 1);
      applyB = projection.apply(eventB);

      await expect(resolvesWithin(applyB, 2_000)).resolves.toBe(true);
      await expect(projection.getProtocolConfig(networkB)).resolves.toMatchObject({
        configAddress: eventB.configAddress,
      });

      releaseHolder.resolve();
      await holder;
      await expect(applyA).resolves.toBe(true);
      await expect(projection.getProtocolConfig(networkA)).resolves.toMatchObject({
        configAddress: eventA.configAddress,
      });
    } finally {
      releaseHolder.resolve();
      await holder?.catch(() => undefined);
      await applyA?.catch(() => undefined);
      await applyB?.catch(() => undefined);
      await projection.clearProjection(networkA);
      await projection.clearProjection(networkB);
      await projection.close();
      await blocker.end({ timeout: 5 });
      await inspection.end({ timeout: 5 });
    }
  });

  it('projects verified manifests idempotently and rebuilds from finalized events', async () => {
    await migrate(databaseUrl);

    const contentRoot = await mkdtemp(join(tmpdir(), 'wokesocial-indexer-integration-'));
    const genesis = bs58.encode(randomBytes(32));
    const networkId = `wokenet:v1:${genesis}:${programId}` as NetworkId;
    const viewer = makeIdentity(networkId, 17);
    const author = makeIdentity(networkId, 29);
    const storage = new LocalContentAddressedStorage({
      rootDirectory: contentRoot,
    });
    const authorizedKeys = new Map([
      [viewer.identityId, viewer.builder.signingKey],
      [author.identityId, author.builder.signingKey],
    ]);
    const projection = new PostgresProjectionStore(databaseUrl);
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(storage, {
        authorize: async ({ authorIdentityId, keyId }) =>
          authorizedKeys.get(authorIdentityId) === keyId,
      }),
    );

    try {
      const profileContent: ProfileContent = {
        displayName: 'River Chen',
        bio: 'Building a user-owned social web.',
        pronouns: [{ value: 'they/them', visibility: 'public' }],
        genderVisibility: 'private',
        chosenFamilyLabels: [],
        links: [{ label: 'Protocol notes', url: 'https://example.com/protocol' }],
      };
      const postContent: PostContent = {
        format: 'plain',
        body: 'A signed post projected from finalized protocol events.',
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
      };

      const profile = await publish(
        storage,
        buildProfilePayload(author.builder, profileContent, {
          createdAt: new Date('2026-07-28T13:02:00.000Z'),
          nonce: nonce(2),
        }),
        author.privateKey,
      );
      const post = await publish(
        storage,
        buildPostPayload(author.builder, postContent, {
          createdAt: new Date('2026-07-28T13:03:00.000Z'),
          nonce: nonce(3),
        }),
        author.privateKey,
      );
      const tombstoneContent: TombstoneContent = {
        target: { id: post.objectId, cid: post.receipt.cid },
        reason: 'author-deleted',
        explanation: 'Integration test lifecycle.',
      };
      const tombstone = await publish(
        storage,
        buildTombstonePayload(author.builder, tombstoneContent, {
          createdAt: new Date('2026-07-28T13:05:00.000Z'),
          nonce: nonce(5),
        }),
        author.privateKey,
      );
      const postReference = bs58.encode(randomBytes(32));
      const communityAddress = bs58.encode(randomBytes(32));
      const strategy1 = encodeMultibaseBase64Url(randomBytes(32));
      const strategy2 = encodeMultibaseBase64Url(randomBytes(32));
      const nextRootAuthority = bs58.encode(randomBytes(32));
      const delegateAuthority = bs58.encode(randomBytes(32));
      const currentDelegateAuthority = bs58.encode(randomBytes(32));
      const firstDelegationAddress = bs58.encode(randomBytes(32));
      const currentDelegationAddress = bs58.encode(randomBytes(32));
      const authorAuthority = bs58.encode(author.publicKey);

      const events = [
        {
          ...eventBase(networkId, 0n, 20, '2026-07-28T13:00:00.000Z'),
          type: 'protocol-initialized',
          configAddress: bs58.encode(randomBytes(32)),
        },
        identityEvent(viewer, 1n, 1),
        identityEvent(author, 2n, 2),
        {
          ...eventBase(networkId, 3n, 3, '2026-07-28T13:02:01.000Z'),
          type: 'profile-updated',
          identityId: author.identityId,
          objectId: profile.objectId,
          cid: profile.receipt.cid,
          payloadHash: profile.envelope.proof.payloadHash,
          sequence: 1n,
        },
        {
          ...eventBase(networkId, 4n, 4, '2026-07-28T13:03:01.000Z'),
          type: 'post-published',
          identityId: author.identityId,
          authority: authorAuthority,
          postReference,
          objectId: post.objectId,
          cid: post.receipt.cid,
          payloadHash: post.envelope.proof.payloadHash,
          sequence: 2n,
        },
        {
          ...eventBase(networkId, 5n, 5, '2026-07-28T13:04:00.000Z'),
          type: 'follow-changed',
          followerIdentityId: viewer.identityId,
          followedIdentityId: author.identityId,
          active: true,
          sequence: 1n,
        },
        {
          ...eventBase(networkId, 6n, 6, '2026-07-28T13:05:01.000Z'),
          type: 'tombstoned',
          identityId: author.identityId,
          targetObjectId: post.objectId,
          tombstoneObjectId: tombstone.objectId,
          cid: tombstone.receipt.cid,
          payloadHash: tombstone.envelope.proof.payloadHash,
          sequence: 3n,
        },
        {
          ...eventBase(networkId, 7n, 7, '2026-07-28T13:07:00.000Z'),
          type: 'delegation-created',
          identityId: author.identityId,
          delegationAddress: firstDelegationAddress,
          delegateAuthority,
          delegationSequence: 1n,
          identitySequence: 4n,
          scopes: 3,
          issuedAtRootRotationCount: 0n,
          expiresAtSlot: 100n,
        },
        {
          ...eventBase(networkId, 8n, 8, '2026-07-28T13:08:00.000Z'),
          type: 'block-changed',
          blockEdgeAddress: bs58.encode(randomBytes(32)),
          blockerIdentityId: viewer.identityId,
          subjectIdentityId: author.identityId,
          authority: bs58.encode(viewer.publicKey),
          blockerSequence: 2n,
          edgeStateSequence: 1n,
          active: true,
        },
        {
          ...eventBase(networkId, 9n, 9, '2026-07-28T13:09:00.000Z'),
          type: 'community-created',
          communityAddress,
          creatorIdentityId: author.identityId,
          authority: authorAuthority,
          creatorSequence: 5n,
          manifestCid: post.receipt.cid,
          manifestHash: post.envelope.proof.payloadHash,
          governanceVersion: 1,
          governanceStrategyHash: strategy1,
        },
        {
          ...eventBase(networkId, 10n, 10, '2026-07-28T13:10:00.000Z'),
          type: 'community-governance-updated',
          communityAddress,
          creatorIdentityId: author.identityId,
          authority: authorAuthority,
          creatorSequence: 6n,
          previousGovernanceVersion: 1,
          governanceVersion: 2,
          previousStrategyHash: strategy1,
          governanceStrategyHash: strategy2,
        },
        {
          ...eventBase(networkId, 11n, 11, '2026-07-28T13:11:00.000Z'),
          type: 'community-membership-changed',
          communityAddress,
          membershipAddress: bs58.encode(randomBytes(32)),
          memberIdentityId: viewer.identityId,
          assignedByIdentityId: author.identityId,
          authority: authorAuthority,
          authoritySequence: 7n,
          membershipStateSequence: 1n,
          roles: 1,
          active: true,
        },
        {
          ...eventBase(networkId, 12n, 12, '2026-07-28T13:12:00.000Z'),
          type: 'reaction-changed',
          reactionReference: bs58.encode(randomBytes(32)),
          reactorIdentityId: author.identityId,
          targetPostReference: postReference,
          authority: authorAuthority,
          reactionKind: 1,
          reactorSequence: 8n,
          reactionStateSequence: 1n,
          active: true,
        },
        {
          ...eventBase(networkId, 13n, 13, '2026-07-28T13:13:00.000Z'),
          type: 'root-authority-rotated',
          identityId: author.identityId,
          previousRootAuthority: authorAuthority,
          newRootAuthority: nextRootAuthority,
          identitySequence: 9n,
          rotationCount: 1n,
        },
        {
          ...eventBase(networkId, 14n, 14, '2026-07-28T13:14:00.000Z'),
          type: 'delegation-created',
          identityId: author.identityId,
          delegationAddress: currentDelegationAddress,
          delegateAuthority: currentDelegateAuthority,
          delegationSequence: 2n,
          identitySequence: 10n,
          scopes: 1,
          issuedAtRootRotationCount: 1n,
          expiresAtSlot: 100n,
        },
        {
          ...eventBase(networkId, 15n, 15, '2026-07-28T13:15:00.000Z'),
          type: 'delegation-revoked',
          identityId: author.identityId,
          delegationAddress: currentDelegationAddress,
          delegateAuthority: currentDelegateAuthority,
          delegationSequence: 2n,
          identitySequence: 11n,
          delegationStateSequence: 2n,
        },
      ] as const satisfies readonly ProtocolEvent[];

      await projection.clearProjection(networkId);

      for (const event of events.slice(0, 6)) {
        await expect(indexer.ingest(event)).resolves.toMatchObject({
          applied: true,
        });
      }

      const duplicate = await indexer.ingest(events[4]);
      expect(duplicate.applied).toBe(false);
      await expect(projection.checkpoint(networkId)).resolves.toBe(5n);

      const followingFeed = await projection.getFeed({
        networkId,
        viewerIdentityId: viewer.identityId,
        mode: 'following',
        limit: 20,
      });
      expect(followingFeed).toHaveLength(1);
      expect(followingFeed[0]).toMatchObject({
        post: {
          objectId: post.objectId,
          verified: true,
        },
        author: {
          identityId: author.identityId,
        },
        profile: {
          objectId: profile.objectId,
          content: {
            displayName: profileContent.displayName,
            pronouns: profileContent.pronouns,
          },
        },
        reason: {
          kind: 'following',
          followedIdentityId: author.identityId,
        },
      });

      await expect(indexer.ingest(events[6])).resolves.toMatchObject({
        applied: true,
      });
      await expect(projection.checkpoint(networkId)).resolves.toBe(6n);
      await expect(projection.getPost(post.objectId)).resolves.toMatchObject({
        objectId: post.objectId,
        tombstonedAt: '2026-07-28T13:05:01.000Z',
      });
      await expect(
        projection.getFeed({
          networkId,
          viewerIdentityId: viewer.identityId,
          mode: 'following',
          limit: 20,
        }),
      ).resolves.toEqual([]);

      for (const event of events.slice(7)) {
        await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
      }
      await expect(projection.checkpoint(networkId)).resolves.toBe(15n);
      await expect(projection.getProtocolConfig(networkId)).resolves.toMatchObject({
        initializedSlot: 0n,
      });
      await expect(projection.getDelegations(author.identityId)).resolves.toMatchObject([
        {
          delegateAuthority,
          issuedAtRootRotationCount: 0n,
        },
        {
          delegateAuthority: currentDelegateAuthority,
          issuedAtRootRotationCount: 1n,
          revokedAtSlot: 15n,
        },
      ]);
      await expect(
        projection.getBlock(viewer.identityId, author.identityId),
      ).resolves.toMatchObject({
        active: true,
        stateSequence: 1n,
      });
      await expect(projection.getCommunity(networkId, communityAddress)).resolves.toMatchObject({
        manifestVerified: false,
        governanceVersion: 2,
        governanceStrategyHash: strategy2,
      });
      await expect(
        projection.getCommunityMemberships(networkId, communityAddress),
      ).resolves.toMatchObject([{ memberIdentityId: viewer.identityId, roles: 1, active: true }]);
      await expect(
        projection.getReactionsByPostReference(networkId, postReference),
      ).resolves.toMatchObject([{ reactionKind: 1, active: true }]);
      await expect(
        projection.authorizeSigningKey({
          identityId: author.identityId,
          authority: delegateAuthority,
          kind: 'delegation',
          objectType: 'profile',
          slot: 12n,
          transactionSignature: events[12].transactionSignature,
          logIndex: 0,
        }),
      ).resolves.toBe(true);
      await expect(
        projection.authorizeSigningKey({
          identityId: author.identityId,
          authority: delegateAuthority,
          kind: 'delegation',
          objectType: 'profile',
          slot: 14n,
          transactionSignature: events[14].transactionSignature,
          logIndex: 0,
        }),
      ).resolves.toBe(false);
      await expect(
        projection.authorizeSigningKey({
          identityId: author.identityId,
          authority: currentDelegateAuthority,
          kind: 'delegation',
          objectType: 'profile',
          slot: 15n,
          transactionSignature: events[15].transactionSignature,
          logIndex: 0,
        }),
      ).resolves.toBe(false);

      const beforeRebuild = {
        config: await projection.getProtocolConfig(networkId),
        viewer: await projection.getIdentity(viewer.identityId),
        author: await projection.getIdentity(author.identityId),
        delegations: await projection.getDelegations(author.identityId),
        block: await projection.getBlock(viewer.identityId, author.identityId),
        community: await projection.getCommunity(networkId, communityAddress),
        memberships: await projection.getCommunityMemberships(networkId, communityAddress),
        reactions: await projection.getReactionsByPostReference(networkId, postReference),
        profile: await projection.getProfile(author.identityId),
        post: await projection.getPost(post.objectId),
        checkpoint: await projection.checkpoint(networkId),
      };

      const rebuilt = await indexer.rebuild(networkId, [...events].reverse());
      expect(rebuilt).toHaveLength(events.length);
      expect(rebuilt.every((result) => result.applied)).toBe(true);
      await expect(projection.getIdentity(viewer.identityId)).resolves.toEqual(
        beforeRebuild.viewer,
      );
      await expect(projection.getIdentity(author.identityId)).resolves.toEqual(
        beforeRebuild.author,
      );
      await expect(projection.getProfile(author.identityId)).resolves.toEqual(
        beforeRebuild.profile,
      );
      await expect(projection.getPost(post.objectId)).resolves.toEqual(beforeRebuild.post);
      await expect(projection.getProtocolConfig(networkId)).resolves.toEqual(beforeRebuild.config);
      await expect(projection.getDelegations(author.identityId)).resolves.toEqual(
        beforeRebuild.delegations,
      );
      await expect(projection.getBlock(viewer.identityId, author.identityId)).resolves.toEqual(
        beforeRebuild.block,
      );
      await expect(projection.getCommunity(networkId, communityAddress)).resolves.toEqual(
        beforeRebuild.community,
      );
      await expect(
        projection.getCommunityMemberships(networkId, communityAddress),
      ).resolves.toEqual(beforeRebuild.memberships);
      await expect(
        projection.getReactionsByPostReference(networkId, postReference),
      ).resolves.toEqual(beforeRebuild.reactions);
      await expect(projection.checkpoint(networkId)).resolves.toBe(beforeRebuild.checkpoint);
    } finally {
      try {
        await projection.clearProjection(networkId);
      } finally {
        await projection.close();
        await rm(contentRoot, { recursive: true, force: true });
      }
    }
  }, 45_000);
});

interface TestIdentity {
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly identityId: string;
  readonly identityAddress: string;
  readonly builder: ReturnType<typeof createPayloadBuilderIdentity>;
}

function makeIdentity(networkId: NetworkId, keySeed: number): TestIdentity {
  const privateKey = Uint8Array.from({ length: 32 }, (_, index) => (keySeed + index) % 256);
  const publicKey = ed25519.getPublicKey(privateKey);
  const identityAddress = bs58.encode(randomBytes(32));
  const identityId = `wokesocialid:v1:${networkId}:${identityAddress}`;
  return {
    privateKey,
    publicKey,
    identityId,
    identityAddress,
    builder: createPayloadBuilderIdentity(networkId, identityId, publicKey, 'root'),
  };
}

function identityEvent(identity: TestIdentity, slot: bigint, signatureSeed: number): ProtocolEvent {
  return {
    ...eventBase(
      identity.builder.network,
      slot,
      signatureSeed,
      `2026-07-28T13:0${slot.toString()}:00.000Z`,
    ),
    type: 'identity-created',
    identityId: identity.identityId,
    identityAddress: identity.identityAddress,
    rootAuthority: bs58.encode(identity.publicKey),
  };
}

function eventBase(networkId: NetworkId, slot: bigint, signatureSeed: number, blockTime: string) {
  return {
    networkId,
    programId,
    transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => signatureSeed)),
    slot,
    logIndex: 0,
    blockTime,
    finalized: true as const,
  };
}

function nonce(seed: number): Uint8Array {
  return Uint8Array.from({ length: 16 }, (_, index) => seed + index);
}

async function lockNetwork(sql: TransactionSql, networkId: string): Promise<void> {
  await sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${networkId}, 0))
  `;
}

async function waitForAdvisoryWaiters(
  sql: Sql,
  networkId: string,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await sql<{ waiters: number }[]>`
      WITH lock_key AS (
        SELECT hashtextextended(${networkId}, 0) AS value
      )
      SELECT count(*)::integer AS waiters
      FROM pg_locks, lock_key
      WHERE locktype = 'advisory'
        AND NOT granted
        AND classid::bigint = ((value >> 32) & 4294967295)
        AND objid::bigint = (value & 4294967295)
        AND objsubid = 1
    `;
    if ((rows[0]?.waiters ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${expected} advisory-lock waiter(s).`);
}

function deferred() {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function resolvesWithin<Value>(promise: Promise<Value>, timeoutMs: number): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Promise did not resolve within ${timeoutMs} ms.`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function publish(
  storage: LocalContentAddressedStorage,
  payload: PortablePayload,
  privateKey: Uint8Array,
): Promise<{
  readonly envelope: SignedEnvelope;
  readonly objectId: string;
  readonly receipt: StorageReceipt;
}> {
  const envelope = signPayload(payload, privateKey);
  const receipt = await storage.put(canonicalizeEnvelope(envelope), {
    permanence: 'deletion-compatible',
  });
  return {
    envelope,
    objectId: getObjectId(envelope.payload),
    receipt,
  };
}
