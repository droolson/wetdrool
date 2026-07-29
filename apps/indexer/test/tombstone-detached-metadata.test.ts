import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import type { NetworkId, PostContent } from '@wokesocial/protocol';

import {
  ManifestVerifier,
  MemoryProjectionStore,
  OpenIndexer,
  type ProtocolEvent,
  type VerifiedManifest,
} from '../src/index.js';
import { TEST_CID } from './cid-fixtures.js';

const genesis = publicKey(1);
const programId = publicKey(2);
const identityAddress = publicKey(3);
const networkId = `wokenet:v1:${genesis}:${programId}` as NetworkId;
const identityId = `wokesocialid:v1:${networkId}:${identityAddress}`;
const rootAuthority = publicKey(4);
const postReference = publicKey(5);
const postObjectId = objectId('post', 6);
const postPayloadHash = digest(7);

describe('detached tombstone metadata', () => {
  it('applies an optional-CID tombstone without provider I/O and advances the checkpoint', async () => {
    const projection = new MemoryProjectionStore();
    await projection.apply(identityCreated());
    await projection.apply(postPublished(), postManifest());

    const get = vi.fn(() => Promise.reject(new Error('provider is unavailable')));
    const authorize = vi.fn(() => Promise.resolve(true));
    const indexer = new OpenIndexer(projection, new ManifestVerifier({ get }, { authorize }));
    const tombstone = tombstoned();

    await expect(indexer.ingest(tombstone)).resolves.toEqual({
      event: tombstone,
      applied: true,
    });
    expect(get).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    await expect(projection.getPost(postObjectId)).resolves.toMatchObject({
      tombstonedAt: tombstone.blockTime,
    });
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 2n,
      updatedSlot: 3n,
    });
    await expect(projection.checkpoint(networkId)).resolves.toBe(3n);
  });
});

function identityCreated(): ProtocolEvent {
  return {
    ...eventBase(1n, 1),
    type: 'identity-created',
    identityId,
    identityAddress,
    rootAuthority,
  };
}

function postPublished(): Extract<ProtocolEvent, { readonly type: 'post-published' }> {
  return {
    ...eventBase(2n, 2),
    type: 'post-published',
    identityId,
    authority: rootAuthority,
    postReference,
    objectId: postObjectId,
    cid: TEST_CID,
    payloadHash: postPayloadHash,
    sequence: 1n,
  };
}

function tombstoned(): Extract<ProtocolEvent, { readonly type: 'tombstoned' }> {
  return {
    ...eventBase(3n, 3),
    type: 'tombstoned',
    identityId,
    targetPostReference: postReference,
    targetObjectId: postObjectId,
    tombstoneObjectId: objectId('tombstone', 8),
    cid: TEST_CID,
    payloadHash: digest(9),
    sequence: 2n,
  };
}

function postManifest(): VerifiedManifest {
  const content = {
    format: 'plain',
    body: 'Canonical post suppressed by its finalized on-chain tombstone.',
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
  return {
    objectId: postObjectId,
    cid: TEST_CID,
    payloadHash: postPayloadHash,
    schemaVersion: 2,
    signingKeyId: `${identityId}#root/${rootAuthority}`,
    authorIdentityId: identityId,
    createdAt: '2026-07-28T12:00:02.000Z',
    type: 'post',
    content,
  };
}

function eventBase(slot: bigint, signatureSeed: number) {
  return {
    networkId,
    programId,
    transactionSignature: signature(signatureSeed),
    transactionIndex: 0,
    slot,
    logIndex: 0,
    blockTime: `2026-07-28T12:00:0${slot.toString()}.000Z`,
    finalized: true as const,
  };
}

function objectId(type: 'post' | 'tombstone', seed: number): string {
  return `wokesocialobj:v1:${type}:${digest(seed)}`;
}

function digest(seed: number): string {
  return `u${Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => seed + index)).toString(
    'base64url',
  )}`;
}

function publicKey(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 32 }, (_, index) => ((seed + index) % 255) + 1));
}

function signature(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 64 }, (_, index) => ((seed + index) % 255) + 1));
}
