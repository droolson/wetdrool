import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import {
  buildCommunityPayload,
  buildPostPayload,
  buildProfilePayload,
  canonicalizeEnvelope,
  communityGovernanceStrategyCommitment,
  createPayloadBuilderIdentity,
  getObjectId,
  signPayload,
  WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  type NetworkId,
  type PortablePayload,
  type PostContent,
  type ProfileContent,
  type CommunityContent,
  type SignedEnvelope,
} from '@wokesocial/protocol';
import { RateLimitBackendUnavailableError, type RateLimiter } from '@wokesocial/rate-limit';
import { MemoryContentAddressedStorage, type StorageReceipt } from '@wokesocial/storage';
import { createProtocolFixtureSet } from '@wokesocial/test-fixtures';

import {
  buildIndexerApp,
  ManifestVerifier,
  MemoryProjectionStore,
  OpenIndexer,
  OPEN_INDEXER_FEED_RECIPE,
  ProjectionError,
  ProjectionRootKeyAuthorizer,
  type GovernanceProposalProjection,
  type GovernanceVoteProjection,
} from '../src/index.js';
import {
  projectionSecurityNetworkId,
  seedAdversarialFeedProjection,
} from './projection-security-fixtures.js';

const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 31);
const publicKey = ed25519.getPublicKey(privateKey);
const genesisHash = bs58.encode(Uint8Array.from({ length: 32 }, () => 21));
const programId = bs58.encode(Uint8Array.from({ length: 32 }, () => 22));
const identityAddress = bs58.encode(Uint8Array.from({ length: 32 }, () => 23));
const networkId = `wokenet:v1:${genesisHash}:${programId}` as NetworkId;
const identityId = `wokesocialid:v1:${networkId}:${identityAddress}`;
const builderIdentity = createPayloadBuilderIdentity(networkId, identityId, publicKey, 'root');
const transactionSignature = (seed: number) =>
  bs58.encode(Uint8Array.from({ length: 64 }, () => seed));

const profileContent: ProfileContent = {
  displayName: 'River Chen',
  bio: 'Building a social web people can carry with them.',
  pronouns: [{ visibility: 'public', value: 'they/them' }],
  chosenFamilyLabels: [],
  links: [],
};
const postContent: PostContent = {
  format: 'plain',
  body: 'A finalized post with its receipt attached.',
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

describe('indexer HTTP contract', () => {
  it('fails protected requests closed without hiding liveness when admission is unavailable', async () => {
    const projection = new MemoryProjectionStore();
    const unavailableHealth = {
      mode: 'redis',
      status: 'not-ready',
      ready: false,
      consecutiveFailures: 1,
      checkedAt: Date.now(),
      lastSuccessAt: null,
      lastFailureAt: Date.now(),
      errorCode: 'RATE_LIMIT_BACKEND_UNAVAILABLE',
    } as const;
    const rateLimiter: RateLimiter = {
      consume: async () => {
        throw new RateLimitBackendUnavailableError('consume', 1);
      },
      read: async () => {
        throw new RateLimitBackendUnavailableError('read', 1);
      },
      readiness: async () => unavailableHealth,
      health: () => unavailableHealth,
      close: async () => undefined,
    };
    const app = await buildIndexerApp({ projection, logger: false, rateLimiter });

    try {
      const [health, readiness, protectedResponse] = await Promise.all([
        app.inject({ method: 'GET', url: '/healthz' }),
        app.inject({ method: 'GET', url: '/readyz' }),
        app.inject({ method: 'GET', url: '/openapi.json' }),
      ]);
      expect(health.statusCode).toBe(200);
      expect(readiness.statusCode).toBe(503);
      expect(protectedResponse.statusCode).toBe(503);
      expect(protectedResponse.json()).toEqual({
        error: {
          code: 'dependency-unavailable',
          message: 'A required service dependency is unavailable.',
        },
      });
    } finally {
      await app.close();
      await projection.close();
    }
  });

  it('verifies and publicly projects the immutable signed profile-v1 fixture', async () => {
    const fixtures = createProtocolFixtureSet();
    const historicalProfile = fixtures.manifests.aliceProfileV1;
    const fixtureIdentity = fixtures.participants.alice;
    const fixtureProgramId = fixtures.network.split(':').at(-1);
    const fixtureIdentityAddress = fixtureIdentity.author.split(':').at(-1);
    if (fixtureProgramId === undefined || fixtureIdentityAddress === undefined) {
      throw new Error('The historical fixture identifiers are malformed.');
    }

    const storage = new MemoryContentAddressedStorage();
    const receipt = await storage.put(historicalProfile.canonicalBytes, {
      permanence: 'deletion-compatible',
    });
    const projection = new MemoryProjectionStore();
    const verifier = new ManifestVerifier(
      storage,
      {
        authorize: async () => true,
      },
      { profileSchemaV2ActivationSlot: 3n },
    );
    const indexer = new OpenIndexer(projection, verifier);
    const profileEvent = {
      networkId: fixtures.network,
      programId: fixtureProgramId,
      transactionSignature: transactionSignature(92),
      slot: 2n,
      logIndex: 0,
      blockTime: '2026-07-28T14:02:01.000Z',
      finalized: true as const,
      type: 'profile-updated' as const,
      identityId: fixtureIdentity.author,
      authority: bs58.encode(fixtureIdentity.publicKey),
      objectId: historicalProfile.objectId,
      cid: receipt.cid,
      payloadHash: historicalProfile.envelope.proof.payloadHash,
      sequence: 1n,
    };

    try {
      await indexer.ingest({
        networkId: fixtures.network,
        programId: fixtureProgramId,
        transactionSignature: transactionSignature(91),
        slot: 1n,
        logIndex: 0,
        blockTime: '2026-07-28T14:01:00.000Z',
        finalized: true,
        type: 'identity-created',
        identityId: fixtureIdentity.author,
        identityAddress: fixtureIdentityAddress,
        rootAuthority: bs58.encode(fixtureIdentity.publicKey),
      });

      await expect(verifier.forEvent(profileEvent)).resolves.toMatchObject({
        schemaVersion: 1,
        content: {
          genderVisibility: 'private',
        },
      });
      await expect(
        verifier.forEvent({
          ...profileEvent,
          transactionSignature: transactionSignature(93),
          slot: 3n,
        }),
      ).rejects.toMatchObject({ code: 'schema-version' });
      await expect(
        verifier.forEvent({
          ...profileEvent,
          transactionSignature: transactionSignature(94),
          profileSchemaVersion: 1,
        }),
      ).rejects.toMatchObject({ code: 'schema-version' });
      await expect(
        verifier.forEvent({
          ...profileEvent,
          transactionSignature: transactionSignature(95),
          profileSchemaVersion: 2,
        }),
      ).rejects.toMatchObject({ code: 'schema-version' });
      await expect(indexer.ingest(profileEvent)).resolves.toMatchObject({ applied: true });

      const projected = await projection.getProfile(fixtureIdentity.author);
      expect(projected?.content).toEqual({
        displayName: 'Alice Example',
        bio: 'Building kinder, user-owned social spaces.',
        pronouns: [{ visibility: 'public', value: 'she/her' }],
        chosenFamilyLabels: [],
        links: [{ label: 'Protocol notes', url: 'https://example.com/alice/protocol' }],
      });
      expect(JSON.stringify(projected?.content)).not.toContain('genderVisibility');
    } finally {
      await projection.close();
    }
  });

  it('returns a retryable 503 when bounded public-search capacity is unavailable', async () => {
    const projection = new MemoryProjectionStore();
    vi.spyOn(projection, 'searchPublic').mockRejectedValue(
      new ProjectionError('Search capacity exhausted.', 'search-capacity'),
    );
    const app = await buildIndexerApp({
      projection,
      defaultNetworkId: networkId,
      logger: false,
    });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/search/public?q=portable',
      });
      expect(response.statusCode).toBe(503);
      expect(response.headers['retry-after']).toBe('1');
      expect(response.json()).toEqual({
        error: {
          code: 'search-unavailable',
          message: 'Public search is temporarily at capacity. Retry shortly.',
        },
      });
    } finally {
      await app.close();
      await projection.close();
    }
  });

  it('fails honestly when no default network is configured', async () => {
    const projection = new MemoryProjectionStore();
    const app = await buildIndexerApp({ projection, logger: false });

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/feed/home' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        error: { code: 'network-not-configured' },
      });
      const genericFeedResponse = await app.inject({
        method: 'GET',
        url: '/v1/feed?limit=20',
      });
      expect(genericFeedResponse.statusCode).toBe(503);
      expect(genericFeedResponse.json()).toMatchObject({
        error: { code: 'network-not-configured' },
      });
      const searchResponse = await app.inject({
        method: 'GET',
        url: '/v1/search/public?q=portable',
      });
      expect(searchResponse.statusCode).toBe(503);
      expect(searchResponse.json()).toMatchObject({
        error: { code: 'network-not-configured' },
      });
    } finally {
      await app.close();
      await projection.close();
    }
  });

  it('serves only verified projection data with finalized proof metadata', async () => {
    const fixture = await indexedFixture();
    const app = await buildIndexerApp({
      projection: fixture.projection,
      defaultNetworkId: networkId,
      logger: false,
    });

    try {
      const feedResponse = await app.inject({
        method: 'GET',
        url: '/v1/feed/home?limit=20',
      });
      expect(feedResponse.statusCode).toBe(200);
      expect(feedResponse.json()).toMatchObject({
        meta: {
          checkpointSlot: 3,
          source: 'WokeNet open indexer',
        },
        posts: [
          {
            author: {
              displayName: profileContent.displayName,
              handle: null,
              identityId,
            },
            body: postContent.body,
            bodyReference: null,
            id: fixture.post.objectId,
            language: postContent.language,
            verification: {
              anchor: {
                finality: 'finalized',
                slot: 3,
                transaction: transactionSignature(3),
              },
              contentHash: fixture.post.envelope.proof.payloadHash,
              contentHashValid: true,
              manifestUri: `ipfs://${fixture.post.receipt.cid}`,
              signatureValid: true,
              state: 'verified',
            },
          },
        ],
      });

      const postResponse = await app.inject({
        method: 'GET',
        url: `/v1/posts/${encodeURIComponent(fixture.post.objectId)}`,
      });
      expect(postResponse.statusCode).toBe(200);
      expect(postResponse.json()).toMatchObject({
        meta: { checkpointSlot: 3 },
        post: { id: fixture.post.objectId },
      });

      const personSearch = await app.inject({
        method: 'GET',
        url: '/v1/search/public?q=River&limit=10',
      });
      expect(personSearch.statusCode).toBe(200);
      expect(personSearch.json()).toMatchObject({
        canonical: false,
        network: networkId,
        query: 'river',
        ranking: { deterministic: true, version: 'public-match-v2' },
        scope: 'public-finalized-projection',
        results: [
          {
            kind: 'person',
            matchedBy: 'display-name',
            identityId,
            displayName: profileContent.displayName,
            handle: null,
          },
        ],
      });

      const postSearch = await app.inject({
        method: 'GET',
        url: `/v1/search?q=finalized&limit=10&network=${encodeURIComponent(networkId)}`,
      });
      expect(postSearch.statusCode).toBe(200);
      expect(postSearch.json()).toMatchObject({
        query: 'finalized',
        results: [
          {
            kind: 'post',
            matchedBy: 'post-body',
            post: {
              id: fixture.post.objectId,
              visibility: 'public',
              verification: { state: 'verified' },
            },
          },
        ],
      });

      const unknownQuery = await app.inject({
        method: 'GET',
        url: '/v1/feed/home?limit=20&operatorOverride=true',
      });
      expect(unknownQuery.statusCode).toBe(400);
      const invalidSearch = await app.inject({
        method: 'GET',
        url: '/v1/search/public?q=x&private=true',
      });
      expect(invalidSearch.statusCode).toBe(400);
      const normalizedTooShort = await app.inject({
        method: 'GET',
        url: '/v1/search/public?q=%EF%BC%A1%EF%BC%A2',
      });
      expect(normalizedTooShort.statusCode).toBe(400);
      expect(normalizedTooShort.json()).toMatchObject({
        error: {
          issues: [
            {
              path: 'q',
              message: 'Normalized search queries must contain at least 3 characters.',
            },
          ],
        },
      });
      const compatibilityExpansion = await app.inject({
        method: 'GET',
        url: '/v1/search/public?q=%EF%AC%83',
      });
      expect(compatibilityExpansion.statusCode).toBe(200);
      expect(compatibilityExpansion.json()).toMatchObject({ query: 'ffi', results: [] });
      const controlSearch = await app.inject({
        method: 'GET',
        url: '/v1/search/public?q=abc%09def',
      });
      expect(controlSearch.statusCode).toBe(400);

      const invalidObjectId = await app.inject({
        method: 'GET',
        url: '/v1/posts/not-an-object-id',
      });
      expect(invalidObjectId.statusCode).toBe(400);
    } finally {
      await app.close();
      await fixture.projection.close();
    }
  });

  it('serializes a valid empty profile display name with the consumer fallback', async () => {
    const fixture = await indexedFixture({ ...profileContent, displayName: '' });
    const app = await buildIndexerApp({
      projection: fixture.projection,
      defaultNetworkId: networkId,
      logger: false,
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/feed/home?limit=1' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        posts: [{ author: { displayName: 'Unnamed member', identityId } }],
      });
    } finally {
      await app.close();
      await fixture.projection.close();
    }
  });

  it('paginates equal finalized times opaquely and never exposes unlisted feed plaintext', async () => {
    const projection = new MemoryProjectionStore();
    const fixture = await seedAdversarialFeedProjection(projection, 150);
    const app = await buildIndexerApp({
      projection,
      defaultNetworkId: fixture.networkId,
      logger: false,
    });

    try {
      interface FeedPage {
        entries: { post: { objectId: string } }[];
        meta: { checkpointSlot: number | null };
        mode: string;
        network: string;
        nextCursor: string | null;
        recipe: string;
      }
      const collected: string[] = [];
      let cursor: string | null = null;
      for (;;) {
        const feedPageResponse = await app.inject({
          method: 'GET',
          url: `/v1/feed?limit=1${cursor === null ? '' : `&before=${encodeURIComponent(cursor)}`}`,
        });
        expect(feedPageResponse.statusCode, feedPageResponse.body).toBe(200);
        expect(feedPageResponse.body).not.toContain(fixture.unlistedSentinel);
        const body: FeedPage = feedPageResponse.json();
        expect(body).toMatchObject({
          meta: { checkpointSlot: 5 },
          mode: 'chronological',
          network: fixture.networkId,
          recipe: OPEN_INDEXER_FEED_RECIPE,
        });
        const entry = body.entries[0];
        expect(entry).toBeDefined();
        if (entry === undefined) break;
        collected.push(entry.post.objectId);
        if (collected.length < fixture.expectedPublicPostIds.length) {
          expect(body.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/u);
        } else {
          expect(body.nextCursor).toBeNull();
        }
        cursor = body.nextCursor;
        if (cursor === null) break;
      }
      expect(collected).toEqual(fixture.expectedPublicPostIds);

      const firstPage = await app.inject({
        method: 'GET',
        url: '/v1/feed?limit=1',
      });
      const firstCursor = firstPage.json<{
        nextCursor: string | null;
      }>().nextCursor;
      expect(firstCursor).not.toBeNull();

      const crossRecipeCursor = await app.inject({
        method: 'GET',
        url: `/v1/feed?mode=following&viewer=${encodeURIComponent(
          fixture.viewerIdentityId,
        )}&limit=1&before=${encodeURIComponent(firstCursor ?? '')}`,
      });
      expect(crossRecipeCursor.statusCode).toBe(400);
      expect(crossRecipeCursor.json()).toMatchObject({
        error: { code: 'invalid-feed-cursor' },
      });
      const foreignViewer = `wokesocialid:v1:${projectionSecurityNetworkId(
        151,
      )}:11111111111111111111111111111111`;
      const crossNetworkViewer = await app.inject({
        method: 'GET',
        url: `/v1/feed?mode=following&viewer=${encodeURIComponent(foreignViewer)}&limit=1`,
      });
      expect(crossNetworkViewer.statusCode).toBe(400);
      expect(crossNetworkViewer.json()).toMatchObject({
        error: {
          code: 'invalid-query',
          issues: [{ path: 'viewer' }],
        },
      });

      const home = await app.inject({ method: 'GET', url: '/v1/feed/home?limit=20' });
      expect(home.statusCode).toBe(200);
      expect(home.body).not.toContain(fixture.unlistedSentinel);
      expect(home.json<{ posts: { id: string }[] }>().posts.map(({ id }) => id)).toEqual(
        fixture.expectedPublicPostIds,
      );

      const following = await app.inject({
        method: 'GET',
        url: `/v1/feed?network=${encodeURIComponent(
          fixture.networkId,
        )}&mode=following&viewer=${encodeURIComponent(fixture.viewerIdentityId)}&limit=20`,
      });
      expect(following.statusCode).toBe(200);
      expect(following.body).not.toContain(fixture.unlistedSentinel);

      const malformed = await app.inject({
        method: 'GET',
        url: `/v1/feed?network=${encodeURIComponent(fixture.networkId)}&before=not%2Bopaque`,
      });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toMatchObject({ error: { code: 'invalid-feed-cursor' } });
    } finally {
      await app.close();
      await projection.clearProjection(fixture.networkId);
      await projection.close();
    }
  });

  it('removes tombstoned content from both feed and post routes', async () => {
    const fixture = await indexedFixture();
    await fixture.indexer.ingest({
      ...eventBase(4n, 4, '2026-07-28T14:04:00.000Z'),
      type: 'tombstoned',
      identityId,
      targetPostReference: fixture.postReference,
      targetObjectId: fixture.post.objectId,
      sequence: 3n,
    });
    const app = await buildIndexerApp({
      projection: fixture.projection,
      defaultNetworkId: networkId,
      logger: false,
    });

    try {
      const feedResponse = await app.inject({ method: 'GET', url: '/v1/feed/home' });
      expect(feedResponse.statusCode).toBe(200);
      expect(feedResponse.json()).toMatchObject({
        meta: { checkpointSlot: 4 },
        posts: [],
      });

      const postResponse = await app.inject({
        method: 'GET',
        url: `/v1/posts/${encodeURIComponent(fixture.post.objectId)}`,
      });
      expect(postResponse.statusCode).toBe(404);

      const searchResponse = await app.inject({
        method: 'GET',
        url: '/v1/search/public?q=finalized',
      });
      expect(searchResponse.statusCode).toBe(200);
      expect(searchResponse.json()).toMatchObject({ results: [] });
    } finally {
      await app.close();
      await fixture.projection.close();
    }
  });

  it('exposes honest Phase-2 security, community, membership, and reaction projections', async () => {
    const fixture = await indexedFixture();
    const authority = bs58.encode(publicKey);
    const communityAddress = bs58.encode(Uint8Array.from({ length: 32 }, () => 41));
    const communityManifest = await publish(
      fixture.storage,
      buildCommunityPayload(
        builderIdentity,
        {
          slug: 'kind-builders',
          name: 'Kind Builders',
          description: 'Building public infrastructure with care.',
          visibility: 'public',
          membershipPolicy: 'open',
          governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
          federationPolicy: { mode: 'open', allow: [], block: [] },
          replacement: { sequence: 1 },
        },
        {
          createdAt: new Date('2026-07-28T14:04:30.000Z'),
          nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 61),
        },
      ),
    );
    const governance = communityGovernanceStrategyCommitment({
      governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
    });
    await fixture.indexer.ingest({
      ...eventBase(4n, 4, '2026-07-28T14:04:00.000Z'),
      type: 'delegation-created',
      identityId,
      delegationAddress: bs58.encode(Uint8Array.from({ length: 32 }, () => 43)),
      delegateAuthority: bs58.encode(Uint8Array.from({ length: 32 }, () => 44)),
      delegationSequence: 1n,
      identitySequence: 3n,
      scopes: 1,
      issuedAtRootRotationCount: 0n,
      expiresAtSlot: 100n,
    });
    await fixture.indexer.ingest({
      ...eventBase(5n, 5, '2026-07-28T14:05:00.000Z'),
      type: 'community-created',
      communityAddress,
      creatorIdentityId: identityId,
      authority,
      communityNonce: communityManifest.envelope.payload.nonce,
      creatorSequence: 4n,
      manifestCid: communityManifest.receipt.cid,
      manifestHash: communityManifest.envelope.proof.payloadHash,
      governanceVersion: governance.governanceVersion,
      governanceStrategyHash: governance.digest,
    });
    await fixture.indexer.ingest({
      ...eventBase(6n, 6, '2026-07-28T14:06:00.000Z'),
      type: 'community-membership-changed',
      communityAddress,
      membershipAddress: bs58.encode(Uint8Array.from({ length: 32 }, () => 45)),
      memberIdentityId: identityId,
      assignedByIdentityId: identityId,
      authority,
      authoritySequence: 5n,
      membershipStateSequence: 1n,
      roles: 1,
      active: true,
    });
    await fixture.indexer.ingest({
      ...eventBase(7n, 7, '2026-07-28T14:07:00.000Z'),
      type: 'reaction-changed',
      reactionReference: bs58.encode(Uint8Array.from({ length: 32 }, () => 46)),
      reactorIdentityId: identityId,
      targetPostReference: fixture.postReference,
      authority,
      reactionKind: 1,
      reactorSequence: 6n,
      reactionStateSequence: 1n,
      active: true,
    });
    const indexAdditionalCommunity = async (
      visibility: CommunityContent['visibility'],
      seed: number,
      creatorSequence: bigint,
      slot: bigint,
    ) => {
      const address = bs58.encode(Uint8Array.from({ length: 32 }, () => seed));
      const manifest = await publish(
        fixture.storage,
        buildCommunityPayload(
          builderIdentity,
          {
            slug: `${visibility}-community-${String(seed)}`,
            name: `${visibility} Community ${String(seed)}`,
            description: `${visibility} directory sentinel ${String(seed)}`,
            visibility,
            membershipPolicy: 'open',
            governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
            federationPolicy: { mode: 'open', allow: [], block: [] },
            replacement: { sequence: 1 },
          },
          {
            createdAt: new Date(`2026-07-28T14:${String(10 + seed).padStart(2, '0')}:00.000Z`),
            nonce: Uint8Array.from({ length: 16 }, (_, index) => index + seed),
          },
        ),
      );
      await fixture.indexer.ingest({
        ...eventBase(slot, seed, `2026-07-28T14:${String(10 + seed).padStart(2, '0')}:01.000Z`),
        type: 'community-created',
        communityAddress: address,
        creatorIdentityId: identityId,
        authority,
        communityNonce: manifest.envelope.payload.nonce,
        creatorSequence,
        manifestCid: manifest.receipt.cid,
        manifestHash: manifest.envelope.proof.payloadHash,
        governanceVersion: governance.governanceVersion,
        governanceStrategyHash: governance.digest,
      });
      return { address, manifest };
    };
    const unlisted = await indexAdditionalCommunity('unlisted', 47, 7n, 8n);
    const privateCommunity = await indexAdditionalCommunity('private', 48, 8n, 9n);
    const newestPublic = await indexAdditionalCommunity('public', 49, 9n, 10n);
    const unverifiedAddress = bs58.encode(Uint8Array.from({ length: 32 }, () => 50));
    await fixture.projection.quarantineManifestEvent(
      {
        ...eventBase(11n, 50, '2026-07-28T15:00:01.000Z'),
        type: 'community-created',
        communityAddress: unverifiedAddress,
        creatorIdentityId: identityId,
        authority,
        communityNonce: communityManifest.envelope.payload.nonce,
        creatorSequence: 10n,
        manifestCid: communityManifest.receipt.cid,
        manifestHash: communityManifest.envelope.proof.payloadHash,
        governanceVersion: governance.governanceVersion,
        governanceStrategyHash: governance.digest,
      },
      {
        eventBody: {},
        failureCode: 'manifest-invalid',
        failureDetail: 'Unverified shell fixture.',
      },
    );
    const hiddenGovernance = [
      {
        communityAddress: privateCommunity.address,
        proposalAddress: bs58.encode(Uint8Array.from({ length: 32 }, () => 52)),
        voteAddress: bs58.encode(Uint8Array.from({ length: 32 }, () => 53)),
      },
      {
        communityAddress: unverifiedAddress,
        proposalAddress: bs58.encode(Uint8Array.from({ length: 32 }, () => 54)),
        voteAddress: bs58.encode(Uint8Array.from({ length: 32 }, () => 55)),
      },
    ].map(({ communityAddress: hiddenCommunityAddress, proposalAddress, voteAddress }, index) => {
      const proposal = {
        networkId,
        communityAddress: hiddenCommunityAddress,
        proposalAddress,
        proposerIdentityId: identityId,
        authority,
        proposerSequence: 11n + BigInt(index),
        previousCommunitySequence: 1n,
        manifestHash: communityManifest.envelope.proof.payloadHash,
        manifestUri: `ipfs://${communityManifest.receipt.cid}`,
        manifestVerified: false,
        governanceVersion: governance.governanceVersion,
        governanceStrategyHash: governance.digest,
        votingModel: 'one-active-member-one-vote',
        eligibleMemberCount: 1n,
        opensAtSlot: 12n,
        closesAtSlot: 20n,
        quorumBps: 5000,
        approvalBps: 5001,
        yesVotes: 1n,
        noVotes: 0n,
        abstainVotes: 0n,
        stateSequence: 1n,
        outcome: 'pending',
        createdSlot: 12n,
        createdAt: '2026-07-28T15:01:00.000Z',
      } satisfies GovernanceProposalProjection;
      const vote = {
        networkId,
        communityAddress: hiddenCommunityAddress,
        proposalAddress,
        voteAddress,
        voterIdentityId: identityId,
        membershipAddress: bs58.encode(Uint8Array.from({ length: 32 }, () => 56 + index)),
        authority,
        voterSequence: 13n + BigInt(index),
        membershipStateSequence: 1n,
        proposalStateSequence: 1n,
        choice: 'yes',
        yesVotes: 1n,
        noVotes: 0n,
        abstainVotes: 0n,
        castSlot: 13n,
        castAt: '2026-07-28T15:02:00.000Z',
      } satisfies GovernanceVoteProjection;
      return { proposal, vote };
    });
    vi.spyOn(fixture.projection, 'getGovernanceProposal').mockImplementation(
      async (requestedNetworkId, proposalAddress) =>
        requestedNetworkId === networkId
          ? hiddenGovernance.find(({ proposal }) => proposal.proposalAddress === proposalAddress)
              ?.proposal
          : undefined,
    );
    const getGovernanceVotesByProposal = vi
      .spyOn(fixture.projection, 'getGovernanceVotesByProposal')
      .mockImplementation(async (requestedNetworkId, proposalAddress) => {
        const match =
          requestedNetworkId === networkId
            ? hiddenGovernance.find(({ proposal }) => proposal.proposalAddress === proposalAddress)
            : undefined;
        return match === undefined ? [] : [match.vote];
      });
    vi.spyOn(fixture.projection, 'getGovernanceVote').mockImplementation(
      async (requestedNetworkId, voteAddress) =>
        requestedNetworkId === networkId
          ? hiddenGovernance.find(({ vote }) => vote.voteAddress === voteAddress)?.vote
          : undefined,
    );
    const app = await buildIndexerApp({ projection: fixture.projection, logger: false });

    try {
      const security = await app.inject({
        method: 'GET',
        url: `/v1/identities/${encodeURIComponent(identityId)}/security`,
      });
      expect(security.statusCode).toBe(200);
      expect(security.json()).toMatchObject({
        canonical: false,
        identity: { identityId, rootRotationCount: '0' },
        delegations: [{ scopes: 1, issuedAtRootRotationCount: '0' }],
      });

      const community = await app.inject({
        method: 'GET',
        url: `/v1/communities/${communityAddress}?network=${encodeURIComponent(networkId)}`,
      });
      expect(community.statusCode).toBe(200);
      expect(community.json()).toMatchObject({
        canonical: false,
        projection: 'wokenet-open-indexer',
        network: networkId,
        community: {
          communityAddress,
          manifestVerified: true,
          objectId: communityManifest.objectId,
          manifestAuthority: authority,
          latestActionAuthority: authority,
          governanceVersion: 1,
          content: { slug: 'kind-builders', visibility: 'public' },
        },
      });
      expect(community.json()).not.toHaveProperty('memberships');
      const communityWithoutNetwork = await app.inject({
        method: 'GET',
        url: `/v1/communities/${communityAddress}`,
      });
      expect(communityWithoutNetwork.statusCode).toBe(400);
      const communitySearch = await app.inject({
        method: 'GET',
        url: `/v1/search?network=${encodeURIComponent(networkId)}&q=builders`,
      });
      expect(communitySearch.statusCode).toBe(200);
      expect(communitySearch.json()).toMatchObject({
        network: networkId,
        ranking: { version: 'public-match-v2' },
        results: [
          {
            kind: 'community',
            matchedBy: 'community-slug',
            community: { communityAddress, manifestVerified: true },
          },
        ],
      });
      const directory = await app.inject({
        method: 'GET',
        url: `/v1/communities?network=${encodeURIComponent(networkId)}&limit=1`,
      });
      expect(directory.statusCode).toBe(200);
      const oversizedDirectory = await app.inject({
        method: 'GET',
        url: `/v1/communities?network=${encodeURIComponent(networkId)}&limit=51`,
      });
      expect(oversizedDirectory.statusCode).toBe(400);
      expect(directory.json()).toMatchObject({
        canonical: false,
        projection: 'wokenet-open-indexer',
        recipe: 'community-directory-v1',
        network: networkId,
        communities: [{ communityAddress: newestPublic.address, manifestVerified: true }],
      });
      expect(directory.body).not.toContain('private directory sentinel');
      expect(directory.body).not.toContain('unlisted directory sentinel');
      const directoryCursor = directory.json<{ nextCursor: string | null }>().nextCursor;
      expect(directoryCursor).toMatch(/^[A-Za-z0-9_-]+$/u);
      const nextDirectory = await app.inject({
        method: 'GET',
        url: `/v1/communities?network=${encodeURIComponent(
          networkId,
        )}&limit=1&before=${encodeURIComponent(directoryCursor ?? '')}`,
      });
      expect(nextDirectory.statusCode).toBe(200);
      expect(nextDirectory.json()).toMatchObject({
        communities: [{ communityAddress }],
        nextCursor: null,
      });
      const foreignNetwork = `wokenet:v1:${bs58.encode(
        Uint8Array.from({ length: 32 }, () => 51),
      )}:${programId}`;
      const crossNetworkCursor = await app.inject({
        method: 'GET',
        url: `/v1/communities?network=${encodeURIComponent(
          foreignNetwork,
        )}&limit=1&before=${encodeURIComponent(directoryCursor ?? '')}`,
      });
      expect(crossNetworkCursor.statusCode).toBe(400);
      expect(crossNetworkCursor.json()).toMatchObject({
        error: { code: 'invalid-community-cursor' },
      });

      for (const [address, expectedStatus] of [
        [unlisted.address, 200],
        [privateCommunity.address, 404],
        [unverifiedAddress, 404],
      ] as const) {
        const detail = await app.inject({
          method: 'GET',
          url: `/v1/communities/${address}?network=${encodeURIComponent(networkId)}`,
        });
        expect(detail.statusCode).toBe(expectedStatus);
        const proposals = await app.inject({
          method: 'GET',
          url: `/v1/communities/${address}/proposals?network=${encodeURIComponent(networkId)}`,
        });
        expect(proposals.statusCode).toBe(expectedStatus);
      }

      for (const { proposal, vote } of hiddenGovernance) {
        const proposalDetail = await app.inject({
          method: 'GET',
          url: `/v1/governance/proposals/${proposal.proposalAddress}?network=${encodeURIComponent(networkId)}`,
        });
        expect(proposalDetail.statusCode).toBe(404);
        expect(proposalDetail.json()).toEqual({
          error: { code: 'not-found', message: 'Proposal was not found.' },
        });

        const proposalVotes = await app.inject({
          method: 'GET',
          url: `/v1/governance/proposals/${proposal.proposalAddress}/votes?network=${encodeURIComponent(networkId)}`,
        });
        expect(proposalVotes.statusCode).toBe(404);
        expect(proposalVotes.json()).toEqual({
          error: { code: 'not-found', message: 'Proposal was not found.' },
        });

        const voteDetail = await app.inject({
          method: 'GET',
          url: `/v1/governance/votes/${vote.voteAddress}?network=${encodeURIComponent(networkId)}`,
        });
        expect(voteDetail.statusCode).toBe(404);
        expect(voteDetail.json()).toEqual({
          error: { code: 'not-found', message: 'Vote was not found.' },
        });

        for (const response of [proposalDetail, proposalVotes, voteDetail]) {
          expect(response.body).not.toContain('voterIdentityId');
          expect(response.body).not.toContain('membershipAddress');
          expect(response.body).not.toContain('choice');
        }
      }
      expect(getGovernanceVotesByProposal).not.toHaveBeenCalled();

      const reactions = await app.inject({
        method: 'GET',
        url: `/v1/reactions?network=${encodeURIComponent(networkId)}&postReference=${fixture.postReference}`,
      });
      expect(reactions.statusCode).toBe(200);
      expect(reactions.json()).toMatchObject({
        canonical: false,
        reactions: [{ reactionKind: 1, active: true }],
      });
      const unknown = await app.inject({
        method: 'GET',
        url: `/v1/reactions?network=${encodeURIComponent(networkId)}&postReference=${fixture.postReference}&unsafe=true`,
      });
      expect(unknown.statusCode).toBe(400);
    } finally {
      await app.close();
      await fixture.projection.close();
    }
  });
});

async function indexedFixture(selectedProfileContent: ProfileContent = profileContent) {
  const storage = new MemoryContentAddressedStorage();
  const projection = new MemoryProjectionStore();
  const indexer = new OpenIndexer(
    projection,
    new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection)),
  );
  await indexer.ingest({
    ...eventBase(1n, 1, '2026-07-28T14:01:00.000Z'),
    type: 'identity-created',
    identityId,
    identityAddress,
    rootAuthority: bs58.encode(publicKey),
  });

  const profile = await publish(
    storage,
    buildProfilePayload(builderIdentity, selectedProfileContent, {
      createdAt: new Date('2026-07-28T14:02:00.000Z'),
      nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 1),
    }),
  );
  await indexer.ingest({
    ...eventBase(2n, 2, '2026-07-28T14:02:01.000Z'),
    type: 'profile-updated',
    identityId,
    objectId: profile.objectId,
    cid: profile.receipt.cid,
    payloadHash: profile.envelope.proof.payloadHash,
    sequence: 1n,
    profileSchemaVersion: 2,
  });

  const post = await publish(
    storage,
    buildPostPayload(builderIdentity, postContent, {
      createdAt: new Date('2026-07-28T14:03:00.000Z'),
      nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 21),
    }),
  );
  const postReference = bs58.encode(Uint8Array.from({ length: 32 }, () => 24));
  await indexer.ingest({
    ...eventBase(3n, 3, '2026-07-28T14:03:01.000Z'),
    type: 'post-published',
    identityId,
    postReference,
    objectId: post.objectId,
    cid: post.receipt.cid,
    payloadHash: post.envelope.proof.payloadHash,
    sequence: 2n,
  });

  return { indexer, post, postReference, projection, storage };
}

function eventBase(slot: bigint, signatureSeed: number, blockTime: string) {
  return {
    networkId,
    programId,
    transactionSignature: transactionSignature(signatureSeed),
    slot,
    logIndex: 0,
    blockTime,
    finalized: true as const,
  };
}

async function publish(
  storage: MemoryContentAddressedStorage,
  payload: PortablePayload,
): Promise<{
  envelope: SignedEnvelope;
  objectId: string;
  receipt: StorageReceipt;
}> {
  const envelope = signPayload(payload, privateKey);
  const receipt = await storage.put(canonicalizeEnvelope(envelope), {
    permanence: 'deletion-compatible',
  });
  return {
    envelope,
    objectId: getObjectId(payload),
    receipt,
  };
}
