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
  buildIndexerApp,
  ManifestVerifier,
  MemoryProjectionStore,
  OpenIndexer,
  PostgresProjectionStore,
  type ProtocolEvent,
  type VerifiedManifest,
} from '../src/index.js';
import { migrate } from '../src/migrate.js';

const databaseUrl =
  process.env['INDEXER_INTEGRATION_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgresql://wokesocial:local-development-only@127.0.0.1:5432/wokesocial';
const programId = bs58.encode(Uint8Array.from({ length: 32 }, () => 8));
const ZERO_DIGEST = 'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

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

  it('uses valid generated search indexes and the same deterministic normalization as JavaScript', async () => {
    await migrate(databaseUrl);
    const inspection = postgres(databaseUrl, { max: 1 });
    const explainNetwork = 'wokenet:v1:public-search-explain:program';

    try {
      const indexes = await inspection<{ index_name: string; valid: boolean }[]>`
        SELECT index_class.relname AS index_name, index.indisvalid AS valid
        FROM pg_index index
        JOIN pg_class index_class ON index_class.oid = index.indexrelid
        WHERE index_class.relname IN (
          'identities_public_search_prefix',
          'profiles_public_name_search',
          'profiles_public_name_search_prefix',
          'profiles_public_bio_search',
          'profiles_public_bio_search_prefix',
          'active_handles_public_search',
          'active_handles_public_search_prefix',
          'active_handles_canonical_by_identity',
          'active_posts_public_search_identifier',
          'active_posts_public_search_body',
          'active_posts_public_search_body_prefix'
        )
        ORDER BY index_class.relname
      `;
      expect(indexes).toHaveLength(11);
      expect(indexes.every((index) => index.valid)).toBe(true);

      const generated = await inspection<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND is_generated = 'ALWAYS'
          AND column_name IN (
            'search_identity_id',
            'search_display_name',
            'search_bio',
            'search_bio_prefix',
            'search_handle',
            'search_object_id',
            'search_body',
            'search_body_prefix'
          )
      `;
      expect(generated).toEqual([{ count: 8 }]);

      const normalized = await inspection<{ value: string }[]>`
        SELECT wokesocial_public_search_normalize(
          ${'  RIVER\u212A \u00a0\u2003 LAB  '}
        ) AS value
      `;
      expect(normalized).toEqual([{ value: 'riverk lab' }]);

      const plan = await inspection.begin(async (sql) => {
        await sql`SET LOCAL enable_seqscan = off`;
        return sql<{ 'QUERY PLAN': unknown }[]>`
          EXPLAIN (COSTS OFF, FORMAT JSON)
          SELECT identity_id
          FROM profiles
          WHERE search_display_name LIKE ${'%needle%'}
        `;
      });
      expect(JSON.stringify(plan)).toContain('profiles_public_name_search');

      await inspection`
        INSERT INTO identities (
          identity_id, network_id, identity_address, root_authority,
          root_rotation_count, created_slot, created_at, updated_slot, updated_at
        )
        SELECT
          'wokesocialid:v1:' || ${explainNetwork} || ':public-search-address-' || value,
          ${explainNetwork},
          'public-search-address-' || value,
          'public-search-root-' || value,
          0,
          1,
          '2026-07-28T16:00:00.000Z',
          1,
          '2026-07-28T16:00:00.000Z'
        FROM generate_series(1, 600) value
      `;
      await inspection`
        INSERT INTO profiles (
          identity_id, object_id, cid, payload_hash, display_name, bio,
          pronouns, updated_slot, updated_at
        )
        SELECT
          'wokesocialid:v1:' || ${explainNetwork} || ':public-search-address-' || value,
          'public-search-profile-' || value,
          'bafy-public-search-profile-' || value,
          ${ZERO_DIGEST},
          CASE WHEN value = 1 THEN '!!! prefix' ELSE 'zz name ' || value END,
          CASE WHEN value = 2 THEN 'ab cd prefix' ELSE 'zz bio ' || value END,
          '[]'::jsonb,
          2,
          '2026-07-28T16:01:00.000Z'
        FROM generate_series(1, 600) value
      `;
      await inspection`
        INSERT INTO handle_claims (
          network_id, handle_claim_address, handle, handle_hash, identity_id,
          authority, identity_sequence, active, claimed_slot, claimed_at
        )
        SELECT
          ${explainNetwork},
          'public-search-claim-' || value,
          CASE WHEN value = 1 THEN 'river' ELSE 'zz' || lpad(value::text, 4, '0') END,
          ${ZERO_DIGEST},
          'wokesocialid:v1:' || ${explainNetwork} || ':public-search-address-' || value,
          'public-search-root-' || value,
          1,
          true,
          3,
          '2026-07-28T16:02:00.000Z'
        FROM generate_series(1, 600) value
      `;
      await inspection`
        INSERT INTO posts (
          object_id, network_id, author_identity_id, cid, payload_hash,
          signing_key_id, body, language, content, created_at,
          anchored_slot, transaction_signature, verified
        )
        SELECT
          'public-search-post-' || value,
          ${explainNetwork},
          'wokesocialid:v1:' || ${explainNetwork} || ':public-search-address-' || value,
          'bafy-public-search-post-' || value,
          ${ZERO_DIGEST},
          'public-search-root-' || value,
          CASE WHEN value = 1 THEN '🔥🔥🔥 prefix' ELSE 'zz post ' || value END,
          'en',
          '{"visibility":{"kind":"public"}}'::jsonb,
          '2026-07-28T16:03:00.000Z',
          4,
          'public-search-transaction-' || value,
          true
        FROM generate_series(1, 600) value
      `;
      await inspection`ANALYZE identities`;
      await inspection`ANALYZE profiles`;
      await inspection`ANALYZE handle_claims`;
      await inspection`ANALYZE posts`;

      const plans = await inspection.begin(async (sql) => {
        await sql`SET LOCAL enable_seqscan = off`;
        return Promise.all([
          sql<{ 'QUERY PLAN': unknown }[]>`
            EXPLAIN (COSTS OFF, FORMAT JSON)
            SELECT identity_id
            FROM handle_claims
            WHERE network_id = ${explainNetwork}
              AND active
              AND search_handle LIKE ${'ri%'}
          `,
          sql<{ 'QUERY PLAN': unknown }[]>`
            EXPLAIN (COSTS OFF, FORMAT JSON)
            SELECT identity_id
            FROM handle_claims
            WHERE network_id = ${explainNetwork}
              AND active
              AND search_handle LIKE ${'%riv%'}
          `,
          sql<{ 'QUERY PLAN': unknown }[]>`
            EXPLAIN (COSTS OFF, FORMAT JSON)
            SELECT identity_id
            FROM profiles
            WHERE search_display_name LIKE ${'!!!%'}
          `,
          sql<{ 'QUERY PLAN': unknown }[]>`
            EXPLAIN (COSTS OFF, FORMAT JSON)
            SELECT identity_id
            FROM profiles
            WHERE search_bio_prefix LIKE ${'ab cd%'}
          `,
          sql<{ 'QUERY PLAN': unknown }[]>`
            EXPLAIN (COSTS OFF, FORMAT JSON)
            SELECT object_id
            FROM posts
            WHERE network_id = ${explainNetwork}
              AND tombstoned_at IS NULL
              AND content -> 'visibility' ->> 'kind' = 'public'
              AND search_body_prefix LIKE ${'🔥🔥🔥%'}
          `,
        ]);
      });
      expect(JSON.stringify(plans[0])).toContain('active_handles_public_search_prefix');
      expect(JSON.stringify(plans[1])).toContain('active_handles_public_search');
      expect(JSON.stringify(plans[2])).toContain('profiles_public_name_search_prefix');
      expect(JSON.stringify(plans[3])).toContain('profiles_public_bio_search_prefix');
      expect(JSON.stringify(plans[4])).toContain('active_posts_public_search_body_prefix');
    } finally {
      await inspection`DELETE FROM posts WHERE network_id = ${explainNetwork}`;
      await inspection`DELETE FROM handle_claims WHERE network_id = ${explainNetwork}`;
      await inspection`
        DELETE FROM profiles
        WHERE identity_id IN (
          SELECT identity_id FROM identities WHERE network_id = ${explainNetwork}
        )
      `;
      await inspection`DELETE FROM identities WHERE network_id = ${explainNetwork}`;
      await inspection.end({ timeout: 5 });
    }
  });

  it('keeps public search on isolated bounded read capacity with cancellation', async () => {
    await migrate(databaseUrl);
    const networkId = `wokenet:v1:${bs58.encode(randomBytes(32))}:${programId}` as NetworkId;
    const projection = new PostgresProjectionStore(databaseUrl, {
      searchConcurrency: 1,
      searchPoolSize: 1,
      searchStatementTimeoutMs: 2_000,
    });
    const timeoutProjection = new PostgresProjectionStore(databaseUrl, {
      searchConcurrency: 1,
      searchPoolSize: 1,
      searchStatementTimeoutMs: 75,
    });
    const blocker = postgres(databaseUrl, { max: 1 });
    const holderReady = deferred();
    const releaseHolder = deferred();
    let holder: Promise<unknown> | undefined;

    try {
      holder = blocker.begin(async (sql) => {
        await sql.unsafe('LOCK TABLE identities IN ACCESS EXCLUSIVE MODE');
        holderReady.resolve();
        await releaseHolder.promise;
      });
      await holderReady.promise;

      const first = projection.searchPublic({ networkId, term: 'needle', limit: 10 });
      await expect(
        projection.searchPublic({ networkId, term: 'needle', limit: 10 }),
      ).rejects.toMatchObject({ code: 'search-capacity' });
      await expect(resolvesWithin(projection.checkpoint(networkId), 500)).resolves.toBeUndefined();

      releaseHolder.resolve();
      await holder;
      await expect(first).resolves.toMatchObject({ checkpoint: undefined, results: [] });

      const timeoutReady = deferred();
      const releaseTimeout = deferred();
      holder = blocker.begin(async (sql) => {
        await sql.unsafe('LOCK TABLE identities IN ACCESS EXCLUSIVE MODE');
        timeoutReady.resolve();
        await releaseTimeout.promise;
      });
      await timeoutReady.promise;
      await expect(
        timeoutProjection.searchPublic({ networkId, term: 'needle', limit: 10 }),
      ).rejects.toMatchObject({ code: 'search-timeout' });
      releaseTimeout.resolve();
      await holder;
    } finally {
      releaseHolder.resolve();
      await holder?.catch(() => undefined);
      await projection.close();
      await timeoutProjection.close();
      await blocker.end({ timeout: 5 });
    }
  });

  it('returns search results and checkpoint from one repeatable-read snapshot', async () => {
    await migrate(databaseUrl);
    const networkId = `wokenet:v1:${bs58.encode(randomBytes(32))}:${programId}` as NetworkId;
    const identityId = `wokesocialid:v1:${networkId}:snapshot-address`;
    const objectId = `snapshot-post-${networkId}`;
    const projection = new PostgresProjectionStore(databaseUrl, {
      searchStatementTimeoutMs: 5_000,
    });
    const writer = postgres(databaseUrl, { max: 1 });
    const inspection = postgres(databaseUrl, { max: 1 });
    const writerReady = deferred();
    const releaseWriter = deferred();
    let pendingWriter: Promise<unknown> | undefined;

    try {
      await projection.clearProjection(networkId);
      await insertSearchIdentity(inspection, networkId, identityId, 'snapshot-address');
      await insertSearchPost(inspection, networkId, identityId, objectId, 'snapshot needle');
      await inspection`
        INSERT INTO indexer_checkpoints (
          network_id, finalized_slot, transaction_signature, log_index
        ) VALUES (${networkId}, 5, 'checkpoint-five', 0)
      `;

      pendingWriter = writer.begin(async (sql) => {
        await sql.unsafe('LOCK TABLE posts IN ACCESS EXCLUSIVE MODE');
        await sql`
          UPDATE posts
          SET tombstoned_at = '2026-07-28T15:06:00.000Z'
          WHERE object_id = ${objectId}
        `;
        await sql`
          UPDATE indexer_checkpoints
          SET finalized_slot = 6, transaction_signature = 'checkpoint-six'
          WHERE network_id = ${networkId}
        `;
        writerReady.resolve();
        await releaseWriter.promise;
      });
      await writerReady.promise;

      const duringCommit = projection.searchPublic({
        networkId,
        term: 'snapshot needle',
        limit: 10,
      });
      await waitForBlockedSearch(inspection);
      releaseWriter.resolve();
      await pendingWriter;

      const consistentOldSnapshot = await duringCommit;
      expect(consistentOldSnapshot).toMatchObject({
        checkpoint: 5n,
        results: [{ kind: 'post', entry: { post: { objectId } } }],
      });
      await expect(
        projection.searchPublic({ networkId, term: 'snapshot needle', limit: 10 }),
      ).resolves.toMatchObject({ checkpoint: 6n, results: [] });
    } finally {
      releaseWriter.resolve();
      await pendingWriter?.catch(() => undefined);
      await projection.clearProjection(networkId);
      await projection.close();
      await writer.end({ timeout: 5 });
      await inspection.end({ timeout: 5 });
    }
  });

  it('matches memory and PostgreSQL for canonical handles, NFKC, ties, and adversarial volume', async () => {
    await migrate(databaseUrl);
    const networkId = `wokenet:v1:${bs58.encode(randomBytes(32))}:${programId}` as NetworkId;
    const postgresProjection = new PostgresProjectionStore(databaseUrl);
    const memoryProjection = new MemoryProjectionStore();
    const inspection = postgres(databaseUrl, { max: 1 });
    const relevantIdentityId = `wokesocialid:v1:${networkId}:relevant`;
    const tieAccentIdentityId = `wokesocialid:v1:${networkId}:tie-é`;
    const tieEmojiIdentityId = `wokesocialid:v1:${networkId}:tie-😀`;
    const noiseIdentities = Array.from({ length: 225 }, (_, index) => ({
      identityAddress: `noise-${index}-needle`,
      identityId: `wokesocialid:v1:${networkId}:noise-${index}-needle`,
    }));
    const identities = [
      ...noiseIdentities,
      { identityAddress: 'relevant', identityId: relevantIdentityId },
      { identityAddress: 'tie-😀', identityId: tieEmojiIdentityId },
      { identityAddress: 'tie-é', identityId: tieAccentIdentityId },
    ];

    try {
      await postgresProjection.clearProjection(networkId);
      const identityRows = identities.map((identity, index) => ({
        identity_id: identity.identityId,
        network_id: networkId,
        identity_address: identity.identityAddress,
        root_authority: `parity-root-${index}`,
        root_rotation_count: '0',
        created_slot: '1',
        created_at: '2026-07-28T16:00:00.000Z',
        updated_slot: '1',
        updated_at: '2026-07-28T16:00:00.000Z',
      }));
      await inspection`
        INSERT INTO identities ${inspection(
          identityRows,
          'identity_id',
          'network_id',
          'identity_address',
          'root_authority',
          'root_rotation_count',
          'created_slot',
          'created_at',
          'updated_slot',
          'updated_at',
        )}
      `;
      const profileRows = [
        {
          identity_id: relevantIdentityId,
          object_id: 'profile-relevant',
          cid: 'bafyprofile-relevant',
          payload_hash: ZERO_DIGEST,
          display_name: '  NEEDLE\u3000\u00a0\u2003\u212aIOSK  ',
          bio: '',
          pronouns: inspection.json([]),
          updated_slot: '2',
          updated_at: '2026-07-28T16:01:00.000Z',
        },
        ...[tieAccentIdentityId, tieEmojiIdentityId].map((identityId) => ({
          identity_id: identityId,
          object_id: `profile-${identityId}`,
          cid: `bafy-${identityId}`,
          payload_hash: ZERO_DIGEST,
          display_name: 'Éclair Tie',
          bio: '',
          pronouns: inspection.json([]),
          updated_slot: '2',
          updated_at: '2026-07-28T16:02:00.000Z',
        })),
      ];
      await inspection`
        INSERT INTO profiles ${inspection(
          profileRows,
          'identity_id',
          'object_id',
          'cid',
          'payload_hash',
          'display_name',
          'bio',
          'pronouns',
          'updated_slot',
          'updated_at',
        )}
      `;
      await inspection`
        INSERT INTO handle_claims (
          network_id, handle_claim_address, handle, handle_hash, identity_id,
          authority, identity_sequence, active, claimed_slot, claimed_at
        ) VALUES
          (
            ${networkId}, 'alpha-claim', 'alpha_handle', ${ZERO_DIGEST},
            ${relevantIdentityId}, ${'parity-root-225'}, 1, true, 3,
            '2026-07-28T16:03:00.000Z'
          ),
          (
            ${networkId}, 'zulu-claim', 'zulu_handle', ${ZERO_DIGEST},
            ${relevantIdentityId}, ${'parity-root-225'}, 2, true, 4,
            '2026-07-28T16:04:00.000Z'
          )
      `;

      for (const [index, identity] of identities.entries()) {
        await memoryProjection.apply({
          ...eventBase(networkId, 1n, index + 1, '2026-07-28T16:00:00.000Z'),
          type: 'identity-created',
          identityId: identity.identityId,
          identityAddress: identity.identityAddress,
          rootAuthority: `parity-root-${index}`,
        } as ProtocolEvent);
      }
      await applyMemoryProfile(
        memoryProjection,
        networkId,
        relevantIdentityId,
        '  NEEDLE\u3000\u00a0\u2003\u212aIOSK  ',
        '2026-07-28T16:01:00.000Z',
        230,
      );
      await applyMemoryProfile(
        memoryProjection,
        networkId,
        tieAccentIdentityId,
        'Éclair Tie',
        '2026-07-28T16:02:00.000Z',
        231,
      );
      await applyMemoryProfile(
        memoryProjection,
        networkId,
        tieEmojiIdentityId,
        'Éclair Tie',
        '2026-07-28T16:02:00.000Z',
        232,
      );
      for (const [index, handle] of ['alpha_handle', 'zulu_handle'].entries()) {
        await memoryProjection.apply({
          ...eventBase(
            networkId,
            BigInt(index + 3),
            240 + index,
            `2026-07-28T16:0${index + 3}:00.000Z`,
          ),
          type: 'handle-claimed',
          handleClaimAddress: `${handle}-claim`,
          identityId: relevantIdentityId,
          authority: 'parity-root-225',
          identitySequence: BigInt(index + 1),
          handleHash: ZERO_DIGEST,
          handle,
        } as ProtocolEvent);
      }

      const terms = [
        'NEEDLE\u00a0\u2003\u212aIOSK',
        'needle',
        'alpha_handle',
        'zulu_handle',
        '@al',
        '@ha',
        '!!!',
        '🔥🔥🔥',
        'ab cd',
        'Éclair',
        'éclair',
      ];
      for (const term of terms) {
        const memory = await memoryProjection.searchPublic({ networkId, term, limit: 50 });
        const projected = await postgresProjection.searchPublic({ networkId, term, limit: 50 });
        expect(projected.results).toEqual(memory.results);
      }
      await expect(
        postgresProjection.searchPublic({ networkId, term: 'needle', limit: 50 }),
      ).resolves.toMatchObject({
        results: [{ identityId: relevantIdentityId, matchedBy: 'display-name' }],
      });
      await expect(
        postgresProjection.searchPublic({ networkId, term: 'zulu_handle', limit: 50 }),
      ).resolves.toMatchObject({ results: [] });
      const tied = await postgresProjection.searchPublic({
        networkId,
        term: 'Éclair',
        limit: 50,
      });
      expect(tied.results.map((result) => result.kind === 'person' && result.identityId)).toEqual([
        tieAccentIdentityId,
        tieEmojiIdentityId,
      ]);
    } finally {
      await postgresProjection.clearProjection(networkId);
      await postgresProjection.close();
      await memoryProjection.close();
      await inspection.end({ timeout: 5 });
    }
  }, 30_000);

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
      await expect(
        projection.searchPublic({
          networkId,
          term: 'River Chen',
          limit: 10,
        }),
      ).resolves.toMatchObject({
        checkpoint: 5n,
        results: [
          {
            kind: 'person',
            matchedBy: 'display-name',
            identityId: author.identityId,
            displayName: profileContent.displayName,
          },
        ],
      });
      await expect(
        projection.searchPublic({
          networkId,
          term: 'projected from finalized',
          limit: 10,
        }),
      ).resolves.toMatchObject({
        checkpoint: 5n,
        results: [
          {
            kind: 'post',
            matchedBy: 'post-body',
            entry: { post: { objectId: post.objectId } },
          },
        ],
      });
      const searchApp = await buildIndexerApp({
        projection,
        defaultNetworkId: networkId,
        logger: false,
      });
      try {
        const response = await searchApp.inject({
          method: 'GET',
          url: '/v1/search/public?q=projected%20from%20finalized',
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          meta: { checkpointSlot: 5 },
          query: 'projected from finalized',
          results: [
            {
              kind: 'post',
              post: { id: post.objectId, verification: { state: 'verified' } },
            },
          ],
        });
      } finally {
        await searchApp.close();
      }

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
      await expect(
        projection.searchPublic({
          networkId,
          term: 'projected from finalized',
          limit: 10,
        }),
      ).resolves.toMatchObject({ checkpoint: 6n, results: [] });

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
        projection.searchPublic({
          networkId,
          term: communityAddress,
          limit: 10,
        }),
      ).resolves.toMatchObject({ checkpoint: 15n, results: [] });
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

async function insertSearchIdentity(
  sql: Sql,
  networkId: string,
  identityId: string,
  identityAddress: string,
): Promise<void> {
  await sql`
    INSERT INTO identities (
      identity_id, network_id, identity_address, root_authority,
      root_rotation_count, created_slot, created_at, updated_slot, updated_at
    ) VALUES (
      ${identityId}, ${networkId}, ${identityAddress}, 'snapshot-root',
      0, 1, '2026-07-28T15:01:00.000Z', 1, '2026-07-28T15:01:00.000Z'
    )
  `;
}

async function insertSearchPost(
  sql: Sql,
  networkId: string,
  identityId: string,
  objectId: string,
  body: string,
): Promise<void> {
  const content: PostContent = {
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
  };
  await sql`
    INSERT INTO posts (
      object_id, network_id, author_identity_id, cid, payload_hash,
      signing_key_id, body, language, content, created_at,
      anchored_slot, transaction_signature, verified
    ) VALUES (
      ${objectId}, ${networkId}, ${identityId}, 'bafysnapshot', ${ZERO_DIGEST},
      'snapshot-root', ${body}, 'en', ${sql.json(content)},
      '2026-07-28T15:05:00.000Z', 5, 'snapshot-transaction', true
    )
  `;
}

async function waitForBlockedSearch(sql: Sql): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await sql<{ blocked: number }[]>`
      SELECT count(*)::integer AS blocked
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE '%FROM posts p%'
    `;
    if ((rows[0]?.blocked ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for a blocked public-search post read.');
}

async function applyMemoryProfile(
  projection: MemoryProjectionStore,
  networkId: NetworkId,
  identityId: string,
  displayName: string,
  blockTime: string,
  signatureSeed: number,
): Promise<void> {
  const objectId = `profile-${signatureSeed}`;
  const event: ProtocolEvent = {
    ...eventBase(networkId, 2n, signatureSeed, blockTime),
    type: 'profile-updated',
    identityId,
    objectId,
    cid: `bafyprofile-${signatureSeed}`,
    payloadHash: ZERO_DIGEST,
    sequence: 1n,
  };
  const manifest: VerifiedManifest = {
    objectId,
    cid: event.cid,
    payloadHash: ZERO_DIGEST,
    signingKeyId: `root-${signatureSeed}`,
    authorIdentityId: identityId,
    createdAt: blockTime,
    type: 'profile',
    content: {
      displayName,
      bio: '',
      pronouns: [],
      genderVisibility: 'private',
      chosenFamilyLabels: [],
      links: [],
    } satisfies ProfileContent,
  };
  await projection.apply(event, manifest);
}

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
