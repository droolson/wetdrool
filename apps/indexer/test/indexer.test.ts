import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildPostPayload,
  canonicalizeEnvelope,
  createPayloadBuilderIdentity,
  getObjectId,
  signPayload,
  type NetworkId,
  type PostContent,
} from '@wokesocial/protocol';
import { MemoryContentAddressedStorage } from '@wokesocial/storage';

import {
  ManifestVerifier,
  MemoryProjectionStore,
  OpenIndexer,
  type ProtocolEvent,
} from '../src/index.js';

const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const publicKey = ed25519.getPublicKey(privateKey);
const genesis = bs58.encode(Uint8Array.from({ length: 32 }, () => 7));
const program = bs58.encode(Uint8Array.from({ length: 32 }, () => 8));
const identityAddress = bs58.encode(Uint8Array.from({ length: 32 }, () => 9));
const authority = bs58.encode(publicKey);
const networkId = `wokenet:v1:${genesis}:${program}` as NetworkId;
const identityId = `wokesocialid:v1:wokenet:v1:${genesis}:${program}:${identityAddress}`;
const identity = createPayloadBuilderIdentity(networkId, identityId, publicKey, 'root');
const content: PostContent = {
  format: 'plain',
  body: 'A real signed manifest in a rebuildable projection.',
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

describe('open indexer', () => {
  let storage: MemoryContentAddressedStorage;
  let projection: MemoryProjectionStore;
  let indexer: OpenIndexer;

  beforeEach(() => {
    storage = new MemoryContentAddressedStorage();
    projection = new MemoryProjectionStore();
    indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(storage, {
        authorize: async ({ keyId }) => keyId === identity.signingKey,
      }),
    );
  });

  it('indexes a verified post, follows it, and rebuilds deterministically', async () => {
    const base = {
      networkId,
      programId: program,
      blockTime: '2026-07-28T12:00:00.000Z',
      finalized: true as const,
    };
    const identityEvent: ProtocolEvent = {
      ...base,
      type: 'identity-created',
      transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 1)),
      slot: 1n,
      logIndex: 0,
      identityId,
      identityAddress,
      rootAuthority: authority,
    };
    await indexer.ingest(identityEvent);

    const payload = buildPostPayload(identity, content, {
      createdAt: new Date('2026-07-28T12:01:00.000Z'),
      nonce: Uint8Array.from({ length: 16 }, (_, index) => index),
    });
    const envelope = signPayload(payload, privateKey);
    const receipt = await storage.put(canonicalizeEnvelope(envelope), {
      permanence: 'deletion-compatible',
    });
    const postEvent: ProtocolEvent = {
      ...base,
      type: 'post-published',
      transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 2)),
      slot: 2n,
      logIndex: 0,
      blockTime: '2026-07-28T12:01:01.000Z',
      identityId,
      objectId: getObjectId(payload),
      cid: receipt.cid,
      payloadHash: envelope.proof.payloadHash,
      sequence: 1n,
    };
    await indexer.ingest(postEvent);

    const first = await projection.getFeed({
      networkId,
      mode: 'chronological',
      limit: 20,
    });
    expect(first).toHaveLength(1);
    const firstEntry = first[0];
    expect(firstEntry).toBeDefined();
    if (firstEntry === undefined) {
      throw new Error('Expected one feed entry.');
    }
    expect(firstEntry.post.verified).toBe(true);

    const events = [postEvent, identityEvent];
    await indexer.rebuild(networkId, events);
    const rebuilt = await projection.getFeed({
      networkId,
      mode: 'chronological',
      limit: 20,
    });
    expect(rebuilt).toEqual(first);
  });

  it('rejects a content-address mismatch', async () => {
    const payload = buildPostPayload(identity, content, {
      createdAt: new Date('2026-07-28T12:01:00.000Z'),
      nonce: Uint8Array.from({ length: 16 }, (_, index) => index),
    });
    const envelope = signPayload(payload, privateKey);
    const wrongReceipt = await storage.put(new TextEncoder().encode('not an envelope'), {
      permanence: 'deletion-compatible',
    });

    await expect(
      indexer.ingest({
        networkId,
        programId: program,
        type: 'post-published',
        transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 3)),
        slot: 2n,
        logIndex: 0,
        blockTime: '2026-07-28T12:01:01.000Z',
        finalized: true,
        identityId,
        objectId: getObjectId(payload),
        cid: wrongReceipt.cid,
        payloadHash: envelope.proof.payloadHash,
        sequence: 1n,
      }),
    ).rejects.toThrow('Stored envelope is invalid');
  });

  it('distinguishes exact duplicate coordinates from immutable event conflicts', async () => {
    const signature = bs58.encode(Uint8Array.from({ length: 64 }, () => 91));
    const configAddress = bs58.encode(Uint8Array.from({ length: 32 }, () => 92));
    const first: ProtocolEvent = {
      networkId,
      programId: program,
      type: 'protocol-initialized',
      transactionSignature: signature,
      transactionIndex: 1,
      slot: 1n,
      logIndex: 0,
      blockTime: '2026-07-28T12:00:00.000Z',
      finalized: true,
      configAddress,
    };

    await expect(indexer.ingest(first)).resolves.toMatchObject({ applied: true });
    await expect(indexer.ingest(first)).resolves.toMatchObject({ applied: false });

    const conflicts: readonly ProtocolEvent[] = [
      { ...first, transactionIndex: 2 },
      { ...first, slot: 2n },
      { ...first, blockTime: '2026-07-28T12:00:01.000Z' },
      {
        networkId,
        programId: program,
        type: 'identity-created',
        transactionSignature: signature,
        transactionIndex: 1,
        slot: 1n,
        logIndex: 0,
        blockTime: '2026-07-28T12:00:00.000Z',
        finalized: true,
        identityId,
        identityAddress,
        rootAuthority: authority,
      },
      {
        ...first,
        configAddress: bs58.encode(Uint8Array.from({ length: 32 }, () => 93)),
      },
    ];
    for (const conflict of conflicts) {
      await expect(indexer.ingest(conflict)).rejects.toMatchObject({
        code: 'event-conflict',
      });
    }

    await expect(projection.getProtocolConfig(networkId)).resolves.toMatchObject({
      configAddress,
    });
    expect(projection.events(networkId)).toEqual([first]);
  });

  it('serializes a rebuild and live apply without orphaning the live raw event', async () => {
    const configEvent: ProtocolEvent = {
      networkId,
      programId: program,
      type: 'protocol-initialized',
      transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 94)),
      slot: 1n,
      logIndex: 0,
      blockTime: '2026-07-28T12:00:00.000Z',
      finalized: true,
      configAddress: bs58.encode(Uint8Array.from({ length: 32 }, () => 95)),
    };
    const liveIdentityEvent: ProtocolEvent = {
      networkId,
      programId: program,
      type: 'identity-created',
      transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 96)),
      slot: 2n,
      logIndex: 0,
      blockTime: '2026-07-28T12:00:01.000Z',
      finalized: true,
      identityId,
      identityAddress,
      rootAuthority: authority,
    };
    await projection.apply(configEvent);

    const rebuild = projection.rebuildProjection(networkId, [{ event: configEvent }]);
    const liveApply = projection.apply(liveIdentityEvent);
    await expect(Promise.all([rebuild, liveApply])).resolves.toEqual([undefined, true]);

    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identityId,
      networkId,
    });
    expect(projection.events(networkId)).toEqual([configEvent, liveIdentityEvent]);
  });
});
