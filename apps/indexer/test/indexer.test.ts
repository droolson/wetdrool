import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildPostPayload,
  buildProfilePayload,
  canonicalizeEnvelope,
  createPayloadBuilderIdentity,
  getObjectId,
  signPayload,
  type NetworkId,
  type PostContent,
  type ProfileContent,
} from '@wetdrool/protocol';
import { MemoryContentAddressedStorage } from '@wetdrool/storage';

import {
  ManifestVerifier,
  MemoryProjectionStore,
  OpenIndexer,
  type ProtocolEvent,
} from '../src/index.js';
import { TEST_CID } from './cid-fixtures.js';

const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const publicKey = ed25519.getPublicKey(privateKey);
const genesis = bs58.encode(Uint8Array.from({ length: 32 }, () => 7));
const program = bs58.encode(Uint8Array.from({ length: 32 }, () => 8));
const identityAddress = bs58.encode(Uint8Array.from({ length: 32 }, () => 9));
const authority = bs58.encode(publicKey);
const networkId = `droolnet:v1:${genesis}:${program}` as NetworkId;
const identityId = `wetdroolid:v1:droolnet:v1:${genesis}:${program}:${identityAddress}`;
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
    const firstSearch = (
      await projection.searchPublic({
        networkId,
        term: 'signed manifest',
        limit: 10,
      })
    ).results;
    expect(firstSearch).toMatchObject([
      {
        kind: 'post',
        matchedBy: 'post-body',
        entry: { post: { objectId: postEvent.objectId } },
      },
    ]);

    const events = [postEvent, identityEvent];
    await indexer.rebuild(networkId, events);
    const rebuilt = await projection.getFeed({
      networkId,
      mode: 'chronological',
      limit: 20,
    });
    expect(rebuilt).toEqual(first);
    expect(
      (
        await projection.searchPublic({
          networkId,
          term: 'signed manifest',
          limit: 10,
        })
      ).results,
    ).toEqual(firstSearch);

    const unlistedPayload = buildPostPayload(
      identity,
      {
        ...content,
        body: 'private-search-marker must remain undiscoverable',
        visibility: { kind: 'unlisted' },
      },
      {
        createdAt: new Date('2026-07-28T12:02:00.000Z'),
        nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 32),
      },
    );
    const unlistedEnvelope = signPayload(unlistedPayload, privateKey);
    const unlistedReceipt = await storage.put(canonicalizeEnvelope(unlistedEnvelope), {
      permanence: 'deletion-compatible',
    });
    await indexer.ingest({
      ...base,
      type: 'post-published',
      transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 4)),
      slot: 3n,
      logIndex: 0,
      blockTime: '2026-07-28T12:02:01.000Z',
      identityId,
      objectId: getObjectId(unlistedPayload),
      cid: unlistedReceipt.cid,
      payloadHash: unlistedEnvelope.proof.payloadHash,
      sequence: 2n,
    });
    await expect(
      projection.searchPublic({ networkId, term: 'private-search-marker', limit: 10 }),
    ).resolves.toMatchObject({ results: [] });
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

  it('preserves a durable terminal disposition through the public rebuild entry point', async () => {
    const identityEvent: ProtocolEvent = {
      networkId,
      programId: program,
      type: 'identity-created',
      transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 81)),
      slot: 1n,
      logIndex: 0,
      blockTime: '2026-07-28T12:00:00.000Z',
      finalized: true,
      identityId,
      identityAddress,
      rootAuthority: authority,
    };
    const rejectedPost: ProtocolEvent = {
      networkId,
      programId: program,
      type: 'post-published',
      transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 82)),
      slot: 2n,
      logIndex: 0,
      blockTime: '2026-07-28T12:01:00.000Z',
      finalized: true,
      identityId,
      objectId: `wetdroolobj:v1:post:u${'A'.repeat(43)}`,
      cid: TEST_CID,
      payloadHash: `u${'A'.repeat(43)}`,
      sequence: 1n,
    };

    await projection.apply(identityEvent);
    await projection.quarantineManifestEvent(rejectedPost, {
      eventBody: {},
      failureCode: 'manifest-invalid',
      failureDetail: 'test immutable rejection',
    });

    await expect(indexer.rebuild(networkId, [rejectedPost, identityEvent])).resolves.toHaveLength(
      2,
    );
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 1n,
    });
    await expect(
      projection.getFeed({ networkId, mode: 'chronological', limit: 10 }),
    ).resolves.toEqual([]);
    await expect(projection.manifestEventDisposition(rejectedPost)).resolves.toEqual({
      state: 'terminal',
      failureCode: 'manifest-invalid',
    });
  });

  it('rebuilds an accepted tombstoned post after its manifest bytes are deleted', async () => {
    const identityEvent: ProtocolEvent = {
      networkId,
      programId: program,
      type: 'identity-created',
      transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 61)),
      transactionIndex: 0,
      slot: 1n,
      logIndex: 0,
      blockTime: '2026-07-28T12:00:00.000Z',
      finalized: true,
      identityId,
      identityAddress,
      rootAuthority: authority,
    };
    const payload = buildPostPayload(identity, content, {
      createdAt: new Date('2026-07-28T12:01:00.000Z'),
      nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 64),
    });
    const envelope = signPayload(payload, privateKey);
    const receipt = await storage.put(canonicalizeEnvelope(envelope), {
      permanence: 'deletion-compatible',
    });
    const postReference = bs58.encode(Uint8Array.from({ length: 32 }, () => 62));
    const post: ProtocolEvent = {
      networkId,
      programId: program,
      type: 'post-published',
      transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 62)),
      transactionIndex: 0,
      slot: 2n,
      logIndex: 0,
      blockTime: '2026-07-28T12:01:01.000Z',
      finalized: true,
      identityId,
      postReference,
      objectId: getObjectId(payload),
      cid: receipt.cid,
      payloadHash: envelope.proof.payloadHash,
      sequence: 1n,
    };
    const tombstone: ProtocolEvent = {
      networkId,
      programId: program,
      type: 'tombstoned',
      transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 63)),
      transactionIndex: 0,
      slot: 3n,
      logIndex: 0,
      blockTime: '2026-07-28T12:02:00.000Z',
      finalized: true,
      identityId,
      targetPostReference: postReference,
      targetObjectId: post.objectId,
      sequence: 2n,
    };

    await indexer.ingest(identityEvent);
    await indexer.ingest(post);
    await storage.delete(receipt.cid);
    const get = vi.spyOn(storage, 'get');

    await expect(indexer.rebuild(networkId, [tombstone, post, identityEvent])).rejects.toThrow(
      'requires every supplied event to exist in the durable raw ledger',
    );
    expect(get).not.toHaveBeenCalled();

    await indexer.ingest(tombstone);
    await expect(
      indexer.rebuild(networkId, [tombstone, post, identityEvent]),
    ).resolves.toHaveLength(3);
    expect(get).not.toHaveBeenCalled();
    await expect(projection.getPost(post.objectId)).resolves.toBeUndefined();
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 2n,
    });
    await expect(projection.findPostObjectIdByReference(networkId, postReference)).resolves.toBe(
      post.objectId,
    );
    await expect(projection.manifestEventDisposition(post)).resolves.toEqual({
      state: 'accepted',
    });
  });

  it('rebuilds the current profile without reading deleted superseded profile bytes', async () => {
    const identityEvent: ProtocolEvent = {
      networkId,
      programId: program,
      type: 'identity-created',
      transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 71)),
      transactionIndex: 0,
      slot: 1n,
      logIndex: 0,
      blockTime: '2026-07-28T12:00:00.000Z',
      finalized: true,
      identityId,
      identityAddress,
      rootAuthority: authority,
    };
    const oldContent: ProfileContent = {
      displayName: 'Deleted historical profile',
      bio: '',
      pronouns: [],
      chosenFamilyLabels: [],
      links: [],
    };
    const currentContent: ProfileContent = {
      ...oldContent,
      displayName: 'Current retained profile',
    };
    const oldPayload = buildProfilePayload(identity, oldContent, {
      createdAt: new Date('2026-07-28T12:01:00.000Z'),
      nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 80),
    });
    const currentPayload = buildProfilePayload(identity, currentContent, {
      createdAt: new Date('2026-07-28T12:02:00.000Z'),
      nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 96),
    });
    const oldEnvelope = signPayload(oldPayload, privateKey);
    const currentEnvelope = signPayload(currentPayload, privateKey);
    const oldReceipt = await storage.put(canonicalizeEnvelope(oldEnvelope), {
      permanence: 'deletion-compatible',
    });
    const currentReceipt = await storage.put(canonicalizeEnvelope(currentEnvelope), {
      permanence: 'deletion-compatible',
    });
    const oldProfile: ProtocolEvent = {
      networkId,
      programId: program,
      type: 'profile-updated',
      transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 72)),
      transactionIndex: 0,
      slot: 2n,
      logIndex: 0,
      blockTime: '2026-07-28T12:01:01.000Z',
      finalized: true,
      identityId,
      objectId: getObjectId(oldPayload),
      cid: oldReceipt.cid,
      payloadHash: oldEnvelope.proof.payloadHash,
      sequence: 1n,
      profileSchemaVersion: 2,
    };
    const currentProfile: ProtocolEvent = {
      networkId,
      programId: program,
      type: 'profile-updated',
      transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 73)),
      transactionIndex: 0,
      slot: 3n,
      logIndex: 0,
      blockTime: '2026-07-28T12:02:01.000Z',
      finalized: true,
      identityId,
      objectId: getObjectId(currentPayload),
      cid: currentReceipt.cid,
      payloadHash: currentEnvelope.proof.payloadHash,
      sequence: 2n,
      profileSchemaVersion: 2,
    };

    await indexer.ingest(identityEvent);
    await indexer.ingest(oldProfile);
    await indexer.ingest(currentProfile);
    await storage.delete(oldReceipt.cid);
    const get = vi.spyOn(storage, 'get');

    await expect(
      indexer.rebuild(networkId, [currentProfile, identityEvent, oldProfile]),
    ).resolves.toHaveLength(3);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(currentReceipt.cid);
    await expect(projection.getProfile(identityId)).resolves.toMatchObject({
      objectId: currentProfile.objectId,
      content: { displayName: 'Current retained profile' },
    });
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 2n,
    });
    await expect(projection.manifestEventDisposition(oldProfile)).resolves.toEqual({
      state: 'accepted',
    });
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
