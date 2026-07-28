import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import {
  buildPostPayload,
  buildProfilePayload,
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
} from '@wokesocial/protocol';
import { MemoryContentAddressedStorage, type StorageReceipt } from '@wokesocial/storage';

import {
  buildIndexerApp,
  ManifestVerifier,
  MemoryProjectionStore,
  OpenIndexer,
  ProjectionRootKeyAuthorizer,
} from '../src/index.js';

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
  pronouns: [{ value: 'they/them', visibility: 'public' }],
  genderVisibility: 'private',
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
  it('fails honestly when no default network is configured', async () => {
    const projection = new MemoryProjectionStore();
    const app = await buildIndexerApp({ projection, logger: false });

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/feed/home' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
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

      const unknownQuery = await app.inject({
        method: 'GET',
        url: '/v1/feed/home?limit=20&operatorOverride=true',
      });
      expect(unknownQuery.statusCode).toBe(400);

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
    } finally {
      await app.close();
      await fixture.projection.close();
    }
  });

  it('exposes honest Phase-2 security, community, membership, and reaction projections', async () => {
    const fixture = await indexedFixture();
    const authority = bs58.encode(publicKey);
    const communityAddress = bs58.encode(Uint8Array.from({ length: 32 }, () => 41));
    const strategyHash = encodeMultibaseBase64Url(Uint8Array.from({ length: 32 }, () => 42));
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
      creatorSequence: 4n,
      manifestCid: fixture.post.receipt.cid,
      manifestHash: fixture.post.envelope.proof.payloadHash,
      governanceVersion: 1,
      governanceStrategyHash: strategyHash,
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
        community: {
          communityAddress,
          manifestVerified: false,
          governanceVersion: 1,
        },
        memberships: [{ memberIdentityId: identityId, roles: 1, active: true }],
      });
      const communityWithoutNetwork = await app.inject({
        method: 'GET',
        url: `/v1/communities/${communityAddress}`,
      });
      expect(communityWithoutNetwork.statusCode).toBe(400);

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

async function indexedFixture() {
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
    buildProfilePayload(builderIdentity, profileContent, {
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

  return { indexer, post, postReference, projection };
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
