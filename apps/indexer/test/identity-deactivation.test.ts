import { createHash } from 'node:crypto';

import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import { encodeMultibaseBase64Url, type NetworkId, type PostContent } from '@wokesocial/protocol';

import {
  buildIndexerApp,
  MemoryProjectionStore,
  protocolEventSchema,
  SOCIAL_PROTOCOL_EVENT_LAYOUT,
  type ProjectionReplayItem,
  type ProtocolEvent,
  type VerifiedManifest,
} from '../src/index.js';
import { TEST_CID } from './cid-fixtures.js';

const programId = SOCIAL_PROTOCOL_EVENT_LAYOUT.programId;
const networkId = `wokenet:v1:${publicKey(1)}:${programId}` as NetworkId;
const configAddress = publicKey(2);
const identityAddress = publicKey(3);
const identityId = `wokesocialid:v1:${networkId}:${identityAddress}`;
const rootAuthority = publicKey(4);
const delegateAuthority = publicKey(5);
const postReference = publicKey(6);
const objectId = `wokesocialobj:v1:post:u${'A'.repeat(43)}`;
const cid = TEST_CID;
const payloadHash = `u${'B'.repeat(43)}`;
const postContent: PostContent = {
  format: 'plain',
  body: 'Retirement marker remains historical.',
  media: [],
  language: 'en',
  contentWarnings: [],
  accessibility: { altTextReminderAcknowledged: false, captionReferences: [] },
  visibility: { kind: 'public' },
  authorLabels: [],
  replyPolicy: 'anyone',
  quotePolicy: 'allowed',
};

describe('identity deactivation projection', () => {
  it('is exact, one-way, replay-safe, historically authorized, and not erasure', async () => {
    const projection = new MemoryProjectionStore();
    const { items, deactivation } = fixture();

    for (const item of items.slice(0, -1)) {
      await projection.apply(item.event, item.manifest);
    }

    await expect(
      projection.searchPublic({ networkId, term: 'wokesocialid', limit: 10 }),
    ).resolves.toMatchObject({
      results: [{ kind: 'person', identityId }],
    });

    const wrongEvents: readonly ProtocolEvent[] = [
      { ...deactivation, transactionSignature: signature(50), identitySequence: 4n },
      { ...deactivation, transactionSignature: signature(51), rootAuthority: publicKey(99) },
      { ...deactivation, transactionSignature: signature(52), configAddress: publicKey(98) },
      {
        ...deactivation,
        transactionSignature: signature(53),
        slot: 2n,
        blockTime: '2026-07-28T12:00:02.000Z',
      },
    ];
    for (const event of wrongEvents) {
      await expect(projection.apply(event)).rejects.toMatchObject({ code: 'stale-event' });
      await expect(projection.getIdentity(identityId)).resolves.toMatchObject({ active: true });
    }

    await expect(projection.apply(deactivation)).resolves.toBe(true);
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      active: false,
      identitySequence: 3n,
      deactivatedSlot: 4n,
      deactivatedAt: '2026-07-28T12:00:04.000Z',
    });

    await expect(authorize(projection, rootAuthority, 'root', 3n, 3)).resolves.toBe(true);
    await expect(authorize(projection, delegateAuthority, 'delegation', 3n, 3)).resolves.toBe(true);
    await expect(authorize(projection, rootAuthority, 'root', 4n, 4)).resolves.toBe(false);
    await expect(authorize(projection, delegateAuthority, 'delegation', 5n, 5)).resolves.toBe(
      false,
    );

    await expect(
      projection.apply({
        ...deactivation,
        transactionSignature: signature(54),
      }),
    ).rejects.toMatchObject({ code: 'stale-event' });
    await expect(
      projection.apply({
        ...deactivation,
        transactionSignature: signature(55),
        identitySequence: 4n,
        slot: 5n,
        blockTime: '2026-07-28T12:00:05.000Z',
      }),
    ).rejects.toThrow('already inactive');
    await expect(
      projection.apply(
        {
          ...base(5n, 56),
          type: 'post-published',
          identityId,
          authority: rootAuthority,
          postReference: publicKey(7),
          objectId: `wokesocialobj:v1:post:u${'C'.repeat(43)}`,
          cid,
          payloadHash,
          sequence: 4n,
        },
        postManifest(`wokesocialobj:v1:post:u${'C'.repeat(43)}`),
      ),
    ).rejects.toThrow('inactive');

    await expect(
      projection.searchPublic({ networkId, term: 'wokesocialid', limit: 10 }),
    ).resolves.toMatchObject({ results: [] });
    await expect(
      projection.searchPublic({ networkId, term: 'retirement marker', limit: 10 }),
    ).resolves.toMatchObject({
      results: [{ kind: 'post', entry: { post: { objectId } } }],
    });
    await expect(
      projection.getFeed({ networkId, mode: 'chronological', limit: 10 }),
    ).resolves.toMatchObject([
      {
        post: { objectId },
        author: { identityId, active: false, deactivatedSlot: 4n },
      },
    ]);

    const app = await buildIndexerApp({ projection, logger: false });
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/identities/${encodeURIComponent(identityId)}/security`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        identity: {
          identityId,
          active: false,
          identitySequence: '3',
          deactivatedSlot: '4',
          deactivatedAt: '2026-07-28T12:00:04.000Z',
        },
      });
      const historicalPost = await app.inject({
        method: 'GET',
        url: `/v1/posts/${encodeURIComponent(objectId)}`,
      });
      expect(historicalPost.statusCode).toBe(200);
      expect(historicalPost.json()).toMatchObject({
        post: {
          id: objectId,
          author: { identityId, active: false },
        },
      });
    } finally {
      await app.close();
    }

    await projection.rebuildProjection(networkId, [...items].reverse());
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      active: false,
      identitySequence: 3n,
    });
    await expect(authorize(projection, rootAuthority, 'root', 3n, 3)).resolves.toBe(true);
    await expect(authorize(projection, rootAuthority, 'root', 4n, 4)).resolves.toBe(false);
  });

  it('requires the strict identity address binding', () => {
    const { deactivation } = fixture();
    expect(
      protocolEventSchema.safeParse({
        ...deactivation,
        identityAddress: publicKey(99),
      }).success,
    ).toBe(false);
    expect(
      protocolEventSchema.safeParse({
        ...deactivation,
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it('retains direct historical handle resolution without public person discovery', async () => {
    const projection = new MemoryProjectionStore();
    const handle = 'retired_member';
    const handleHash = encodeMultibaseBase64Url(
      createHash('sha256').update(handle, 'utf8').digest(),
    );
    const events: readonly ProtocolEvent[] = [
      protocolEventSchema.parse({
        ...base(1n, 70),
        type: 'protocol-initialized',
        configAddress,
      }),
      protocolEventSchema.parse({
        ...base(2n, 71),
        type: 'identity-created',
        identityId,
        identityAddress,
        rootAuthority,
      }),
      protocolEventSchema.parse({
        ...base(3n, 72),
        type: 'handle-claimed',
        handleClaimAddress: publicKey(73),
        identityId,
        authority: rootAuthority,
        identitySequence: 1n,
        handleHash,
        handle,
      }),
      protocolEventSchema.parse({
        ...base(4n, 74),
        type: 'identity-deactivated',
        configAddress,
        identityId,
        identityAddress,
        rootAuthority,
        identitySequence: 2n,
      }),
    ];
    for (const event of events) {
      await projection.apply(event);
    }

    await expect(projection.getHandle(networkId, handle)).resolves.toMatchObject({
      identityId,
      handle,
    });
    await expect(
      projection.searchPublic({ networkId, term: handle, limit: 10 }),
    ).resolves.toMatchObject({ results: [] });
  });

  it('allows an active follower to remove an edge to a retired passive subject', async () => {
    const projection = new MemoryProjectionStore();
    const followerAddress = publicKey(80);
    const followerId = `wokesocialid:v1:${networkId}:${followerAddress}`;
    const followerRoot = publicKey(81);
    const events: readonly ProtocolEvent[] = [
      protocolEventSchema.parse({
        ...base(1n, 82),
        type: 'protocol-initialized',
        configAddress,
      }),
      protocolEventSchema.parse({
        ...base(2n, 83, 0, 0),
        type: 'identity-created',
        identityId,
        identityAddress,
        rootAuthority,
      }),
      protocolEventSchema.parse({
        ...base(2n, 84, 0, 1),
        type: 'identity-created',
        identityId: followerId,
        identityAddress: followerAddress,
        rootAuthority: followerRoot,
      }),
      protocolEventSchema.parse({
        ...base(3n, 85),
        type: 'follow-changed',
        followerIdentityId: followerId,
        followedIdentityId: identityId,
        active: true,
        followerSequence: 1n,
        edgeStateSequence: 1n,
      }),
      protocolEventSchema.parse({
        ...base(4n, 86),
        type: 'identity-deactivated',
        configAddress,
        identityId,
        identityAddress,
        rootAuthority,
        identitySequence: 1n,
      }),
      protocolEventSchema.parse({
        ...base(5n, 87),
        type: 'follow-changed',
        followerIdentityId: followerId,
        followedIdentityId: identityId,
        active: false,
        followerSequence: 2n,
        edgeStateSequence: 2n,
      }),
    ];
    for (const event of events) {
      await expect(projection.apply(event)).resolves.toBe(true);
    }
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({ active: false });
    await expect(projection.getIdentity(followerId)).resolves.toMatchObject({
      active: true,
      identitySequence: 2n,
    });
    await expect(
      projection.rebuildProjection(
        networkId,
        [...events].reverse().map((event) => ({ event })),
      ),
    ).resolves.toBeUndefined();
  });
});

function fixture(): {
  readonly items: readonly ProjectionReplayItem[];
  readonly deactivation: Extract<ProtocolEvent, { readonly type: 'identity-deactivated' }>;
} {
  const initialized = protocolEventSchema.parse({
    ...base(1n, 1, 0, 0),
    type: 'protocol-initialized',
    configAddress,
  });
  const created = protocolEventSchema.parse({
    ...base(1n, 2, 0, 1),
    type: 'identity-created',
    identityId,
    identityAddress,
    rootAuthority,
  });
  const delegated = protocolEventSchema.parse({
    ...base(2n, 3),
    type: 'delegation-created',
    identityId,
    delegationAddress: publicKey(8),
    delegateAuthority,
    delegationSequence: 1n,
    identitySequence: 1n,
    scopes: 3,
    issuedAtRootRotationCount: 0n,
    expiresAtSlot: 100n,
  });
  const post = protocolEventSchema.parse({
    ...base(3n, 6),
    type: 'post-published',
    identityId,
    authority: rootAuthority,
    postReference,
    objectId,
    cid,
    payloadHash,
    sequence: 2n,
  });
  const parsedDeactivation = protocolEventSchema.parse({
    ...base(4n, 4),
    type: 'identity-deactivated',
    configAddress,
    identityId,
    identityAddress,
    rootAuthority,
    identitySequence: 3n,
  });
  if (parsedDeactivation.type !== 'identity-deactivated') {
    throw new Error('Expected an identity deactivation fixture.');
  }
  const deactivation = parsedDeactivation;
  return {
    deactivation,
    items: [
      { event: initialized },
      { event: created },
      { event: delegated },
      { event: post, manifest: postManifest(objectId) },
      { event: deactivation },
    ],
  };
}

function postManifest(id: string): VerifiedManifest {
  return {
    objectId: id,
    cid,
    payloadHash,
    schemaVersion: 1,
    signingKeyId: `${identityId}#root/${rootAuthority}`,
    authorIdentityId: identityId,
    createdAt: '2026-07-28T12:00:03.000Z',
    type: 'post',
    content: postContent,
  };
}

function authorize(
  projection: MemoryProjectionStore,
  authority: string,
  kind: 'root' | 'delegation',
  slot: bigint,
  signatureSeed: number,
): Promise<boolean> {
  return projection.authorizeSigningKey({
    identityId,
    authority,
    kind,
    objectType: 'post',
    slot,
    transactionSignature: signature(signatureSeed),
    logIndex: 0,
  });
}

function base(slot: bigint, signatureSeed: number, logIndex = 0, transactionIndex?: number) {
  return {
    networkId,
    programId,
    transactionSignature: signature(signatureSeed),
    ...(transactionIndex === undefined ? {} : { transactionIndex }),
    slot,
    logIndex,
    blockTime: `2026-07-28T12:00:0${slot.toString()}.000Z`,
    finalized: true as const,
  };
}

function signature(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 64 }, () => seed));
}

function publicKey(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 32 }, () => seed));
}
