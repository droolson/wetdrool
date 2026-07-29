import bs58 from 'bs58';
import { expect } from 'vitest';

import type { NetworkId, PostContent, ProfileContent } from '@wokesocial/protocol';

import type { FeedCursor } from '../src/models.js';
import type { ProtocolEvent } from '../src/events.js';
import type { ProjectionStore, VerifiedManifest } from '../src/projection.js';
import { testCid } from './cid-fixtures.js';

export async function exerciseSameSlotProfileSequencing(
  projection: ProjectionStore,
  seed: number,
): Promise<void> {
  const fixture = identifiers(seed);
  await projection.clearProjection(fixture.networkId);
  try {
    await projection.apply(identityEvent(fixture, 1n, seed + 1, 0));
    const first = profileItem(fixture, 1n, 2n, seed + 2, 0, 'First profile');
    const second = profileItem(fixture, 2n, 2n, seed + 3, 1, 'Second profile');
    await expect(projection.apply(first.event, first.manifest)).resolves.toBe(true);
    await expect(projection.apply(second.event, second.manifest)).resolves.toBe(true);
    await expect(projection.getProfile(fixture.identityId)).resolves.toMatchObject({
      objectId: second.event.objectId,
      content: { displayName: 'Second profile' },
      updatedSlot: 2n,
    });

    const stale = profileItem(fixture, 2n, 3n, seed + 4, 0, 'Stale profile');
    const skipped = profileItem(fixture, 4n, 3n, seed + 5, 1, 'Skipped profile');
    const earlierPosition = profileItem(fixture, 3n, 1n, seed + 6, 1, 'Earlier profile');
    for (const item of [stale, skipped, earlierPosition]) {
      await expect(projection.apply(item.event, item.manifest)).rejects.toMatchObject({
        code: 'stale-event',
      });
    }
    await expect(projection.getProfile(fixture.identityId)).resolves.toMatchObject({
      objectId: second.event.objectId,
      content: { displayName: 'Second profile' },
    });
  } finally {
    await projection.clearProjection(fixture.networkId);
  }
}

export interface AdversarialFeedFixture {
  readonly networkId: NetworkId;
  readonly viewerIdentityId: string;
  readonly expectedPublicPostIds: readonly string[];
  readonly unlistedPostId: string;
  readonly unlistedSentinel: string;
}

export function projectionSecurityNetworkId(seed: number): NetworkId {
  return identifiers(seed).networkId;
}

export async function seedAdversarialFeedProjection(
  projection: ProjectionStore,
  seed: number,
): Promise<AdversarialFeedFixture> {
  const author = identifiers(seed);
  const viewerIdentityAddress = publicKey(seed + 22);
  const viewer: Identifiers = {
    networkId: author.networkId,
    programId: author.programId,
    identityAddress: viewerIdentityAddress,
    identityId: `wokesocialid:v1:${author.networkId}:${viewerIdentityAddress}`,
    rootAuthority: publicKey(seed + 23),
  };
  await projection.clearProjection(author.networkId);
  await projection.apply(identityEvent(author, 1n, seed + 1, 0));
  await projection.apply(identityEvent(viewer, 1n, seed + 2, 1));

  const futureAuthored = postItem(author, {
    sequence: 1n,
    slot: 2n,
    signatureSeed: seed + 3,
    transactionIndex: 0,
    blockTime: '2026-07-28T12:00:01.000Z',
    authoredAt: '9999-12-31T23:59:59.999Z',
    body: 'Future-authored metadata must not pin chronology.',
    visibility: 'public',
  });
  const firstSameTime = postItem(author, {
    sequence: 2n,
    slot: 3n,
    signatureSeed: seed + 4,
    transactionIndex: 0,
    blockTime: '2026-07-28T12:00:02.000Z',
    authoredAt: '2000-01-01T00:00:00.000Z',
    body: 'Backdated metadata must not lower chronology.',
    visibility: 'public',
  });
  const secondSameTime = postItem(author, {
    sequence: 3n,
    slot: 3n,
    signatureSeed: seed + 5,
    transactionIndex: 1,
    blockTime: '2026-07-28T12:00:02.000Z',
    authoredAt: '2030-01-01T00:00:00.000Z',
    body: 'A second finalized post can share the exact block time.',
    visibility: 'public',
  });
  const unlistedSentinel = `UNLISTED_PLAINTEXT_MUST_NOT_ENTER_FEEDS_${seed}`;
  const unlisted = postItem(author, {
    sequence: 4n,
    slot: 4n,
    signatureSeed: seed + 6,
    transactionIndex: 0,
    blockTime: '2026-07-28T12:00:03.000Z',
    authoredAt: '9999-12-31T23:59:59.999Z',
    body: unlistedSentinel,
    visibility: 'unlisted',
  });
  for (const item of [futureAuthored, firstSameTime, secondSameTime, unlisted]) {
    await projection.apply(item.event, item.manifest);
  }

  await projection.apply({
    ...eventBase(author.networkId, author.programId, 5n, seed + 7, 0, '2026-07-28T12:00:04.000Z'),
    type: 'follow-changed',
    followerIdentityId: viewer.identityId,
    followedIdentityId: author.identityId,
    active: true,
    followerSequence: 1n,
    edgeStateSequence: 1n,
  });

  const sameTimeIds = [firstSameTime.event.objectId, secondSameTime.event.objectId]
    .sort()
    .reverse();
  return {
    networkId: author.networkId,
    viewerIdentityId: viewer.identityId,
    expectedPublicPostIds: [...sameTimeIds, futureAuthored.event.objectId],
    unlistedPostId: unlisted.event.objectId,
    unlistedSentinel,
  };
}

export async function expectAdversarialFeedProjection(
  projection: ProjectionStore,
  fixture: AdversarialFeedFixture,
): Promise<void> {
  const full = await projection.getFeed({
    networkId: fixture.networkId,
    mode: 'chronological',
    limit: 20,
  });
  expect(full.map(({ post }) => post.objectId)).toEqual(fixture.expectedPublicPostIds);
  expect(full.map(({ post }) => post.createdAt)).toEqual([
    '2026-07-28T12:00:02.000Z',
    '2026-07-28T12:00:02.000Z',
    '2026-07-28T12:00:01.000Z',
  ]);
  expect(full.map(({ post }) => post.content.body)).not.toContain(fixture.unlistedSentinel);

  const pagedIds: string[] = [];
  let before: FeedCursor | undefined;
  for (;;) {
    const page = await projection.getFeed({
      networkId: fixture.networkId,
      mode: 'chronological',
      limit: 1,
      ...(before === undefined ? {} : { before }),
    });
    const entry = page[0];
    if (entry === undefined) break;
    pagedIds.push(entry.post.objectId);
    before = { createdAt: entry.post.createdAt, objectId: entry.post.objectId };
  }
  expect(pagedIds).toEqual(fixture.expectedPublicPostIds);

  const following = await projection.getFeed({
    networkId: fixture.networkId,
    viewerIdentityId: fixture.viewerIdentityId,
    mode: 'following',
    limit: 20,
  });
  expect(following.map(({ post }) => post.objectId)).toEqual(fixture.expectedPublicPostIds);
  expect(following.map(({ post }) => post.content.body)).not.toContain(fixture.unlistedSentinel);
  await expect(projection.getPost(fixture.unlistedPostId)).resolves.toMatchObject({
    content: { body: fixture.unlistedSentinel, visibility: { kind: 'unlisted' } },
  });
}

interface Identifiers {
  readonly networkId: NetworkId;
  readonly programId: string;
  readonly identityId: string;
  readonly identityAddress: string;
  readonly rootAuthority: string;
}

function identifiers(seed: number): Identifiers {
  const genesis = publicKey(seed);
  const programId = publicKey(seed + 1);
  const identityAddress = publicKey(seed + 2);
  const networkId = `wokenet:v1:${genesis}:${programId}` as NetworkId;
  return {
    networkId,
    programId,
    identityAddress,
    identityId: `wokesocialid:v1:${networkId}:${identityAddress}`,
    rootAuthority: publicKey(seed + 3),
  };
}

function identityEvent(
  fixture: Identifiers,
  slot: bigint,
  signatureSeed: number,
  transactionIndex: number,
): ProtocolEvent {
  return {
    ...eventBase(
      fixture.networkId,
      fixture.programId,
      slot,
      signatureSeed,
      transactionIndex,
      '2026-07-28T12:00:00.000Z',
    ),
    type: 'identity-created',
    identityId: fixture.identityId,
    identityAddress: fixture.identityAddress,
    rootAuthority: fixture.rootAuthority,
  };
}

function profileItem(
  fixture: Identifiers,
  sequence: bigint,
  slot: bigint,
  signatureSeed: number,
  transactionIndex: number,
  displayName: string,
) {
  const objectId = protocolObjectId('profile', signatureSeed);
  const event = {
    ...eventBase(
      fixture.networkId,
      fixture.programId,
      slot,
      signatureSeed,
      transactionIndex,
      '2026-07-28T12:00:01.000Z',
    ),
    type: 'profile-updated' as const,
    identityId: fixture.identityId,
    objectId,
    cid: cid(signatureSeed),
    payloadHash: digest(signatureSeed),
    sequence,
  };
  const content = {
    displayName,
    bio: '',
    pronouns: [],
    chosenFamilyLabels: [],
    links: [],
  } satisfies ProfileContent;
  return {
    event,
    manifest: manifest(event, fixture.identityId, 'profile', content, event.blockTime),
  };
}

function postItem(
  fixture: Identifiers,
  input: {
    readonly sequence: bigint;
    readonly slot: bigint;
    readonly signatureSeed: number;
    readonly transactionIndex: number;
    readonly blockTime: string;
    readonly authoredAt: string;
    readonly body: string;
    readonly visibility: 'public' | 'unlisted';
  },
) {
  const objectId = protocolObjectId('post', input.signatureSeed);
  const event = {
    ...eventBase(
      fixture.networkId,
      fixture.programId,
      input.slot,
      input.signatureSeed,
      input.transactionIndex,
      input.blockTime,
    ),
    type: 'post-published' as const,
    identityId: fixture.identityId,
    objectId,
    cid: cid(input.signatureSeed),
    payloadHash: digest(input.signatureSeed),
    sequence: input.sequence,
  };
  const content = {
    format: 'plain',
    body: input.body,
    media: [],
    language: 'en',
    contentWarnings: [],
    accessibility: { altTextReminderAcknowledged: false, captionReferences: [] },
    visibility: { kind: input.visibility },
    authorLabels: [],
    replyPolicy: 'anyone',
    quotePolicy: 'allowed',
  } satisfies PostContent;
  return {
    event,
    manifest: manifest(event, fixture.identityId, 'post', content, input.authoredAt),
  };
}

function manifest(
  event: {
    readonly objectId: string;
    readonly cid: string;
    readonly payloadHash: string;
  },
  identityId: string,
  type: 'profile' | 'post',
  content: ProfileContent | PostContent,
  createdAt: string,
): VerifiedManifest {
  return {
    objectId: event.objectId,
    cid: event.cid,
    payloadHash: event.payloadHash,
    schemaVersion: 2,
    signingKeyId: `${identityId}#root/${publicKey(240)}`,
    authorIdentityId: identityId,
    createdAt,
    type,
    content,
  };
}

function eventBase(
  networkId: NetworkId,
  programId: string,
  slot: bigint,
  signatureSeed: number,
  transactionIndex: number,
  blockTime: string,
) {
  return {
    networkId,
    programId,
    transactionSignature: signature(signatureSeed),
    transactionIndex,
    slot,
    logIndex: 0,
    blockTime,
    finalized: true as const,
  };
}

function protocolObjectId(type: 'post' | 'profile', seed: number): string {
  return `wokesocialobj:v1:${type}:${digest(seed)}`;
}

function digest(seed: number): string {
  return `u${Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => seed + index)).toString(
    'base64url',
  )}`;
}

function cid(seed: number): string {
  return testCid(seed);
}

function publicKey(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 32 }, (_, index) => ((seed + index) % 255) + 1));
}

function signature(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 64 }, (_, index) => ((seed + index) % 255) + 1));
}
