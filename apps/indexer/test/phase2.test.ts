import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import {
  buildPostPayload,
  canonicalizeEnvelope,
  createPayloadBuilderIdentity,
  encodeMultibaseBase64Url,
  getObjectId,
  signPayload,
  type NetworkId,
  type PostContent,
} from '@socially-woke/protocol';
import { MemoryContentAddressedStorage } from '@socially-woke/storage';

import {
  decodeAnchorEventLog,
  ManifestVerifier,
  MemoryProjectionStore,
  OpenIndexer,
  ProjectionRootKeyAuthorizer,
  SOCIAL_PROTOCOL_EVENT_LAYOUT,
  type ProtocolEvent,
} from '../src/index.js';

const programId = SOCIAL_PROTOCOL_EVENT_LAYOUT.programId;
const genesisHash = publicKey(70);
const networkId = `woke:v1:${genesisHash}:${programId}` as NetworkId;
const configAddress = publicKey(71);
const identityAddress = publicKey(72);
const memberAddress = publicKey(73);
const identityId = `swid:v1:${networkId}:${identityAddress}`;
const memberIdentityId = `swid:v1:${networkId}:${memberAddress}`;
const rootPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const rootAuthority = bs58.encode(ed25519.getPublicKey(rootPrivateKey));
const nextRootAuthority = publicKey(74);
const delegateAuthority = publicKey(75);
const currentDelegateAuthority = publicKey(76);
const postReference = publicKey(77);
const communityAddress = publicKey(78);

describe('Phase-2 Anchor decoding', () => {
  it.each([
    [
      'root-authority-rotated',
      eventData(
        SOCIAL_PROTOCOL_EVENT_LAYOUT.events.RootAuthorityRotated,
        u16(1),
        pubkey(configAddress),
        pubkey(identityAddress),
        pubkey(rootAuthority),
        pubkey(nextRootAuthority),
        u64(2n),
        u64(1n),
        u64(10n),
      ),
    ],
    [
      'delegation-created',
      eventData(
        SOCIAL_PROTOCOL_EVENT_LAYOUT.events.DelegationCreated,
        u16(1),
        pubkey(configAddress),
        pubkey(identityAddress),
        pubkey(publicKey(80)),
        pubkey(delegateAuthority),
        u64(1n),
        u64(2n),
        u16(3),
        u64(0n),
        u64(100n),
        u64(4n),
      ),
    ],
    [
      'delegation-revoked',
      eventData(
        SOCIAL_PROTOCOL_EVENT_LAYOUT.events.DelegationRevoked,
        u16(1),
        pubkey(configAddress),
        pubkey(identityAddress),
        pubkey(publicKey(80)),
        pubkey(delegateAuthority),
        u64(1n),
        u64(3n),
        u64(2n),
        u64(12n),
      ),
    ],
    [
      'block-changed',
      eventData(
        SOCIAL_PROTOCOL_EVENT_LAYOUT.events.BlockStateChanged,
        u16(1),
        pubkey(configAddress),
        pubkey(publicKey(81)),
        pubkey(identityAddress),
        pubkey(memberAddress),
        pubkey(rootAuthority),
        u64(4n),
        u64(1n),
        Uint8Array.of(1),
        u64(5n),
      ),
    ],
    [
      'community-created',
      eventData(
        SOCIAL_PROTOCOL_EVENT_LAYOUT.events.CommunityCreated,
        u16(1),
        pubkey(configAddress),
        pubkey(communityAddress),
        pubkey(identityAddress),
        pubkey(rootAuthority),
        Uint8Array.from({ length: 16 }, (_, index) => index),
        u64(5n),
        bytes(32, 1),
        borshString(`ipfs://${fakeCid()}`),
        u16(1),
        bytes(32, 2),
        u64(6n),
      ),
    ],
    [
      'community-governance-updated',
      eventData(
        SOCIAL_PROTOCOL_EVENT_LAYOUT.events.CommunityGovernanceUpdated,
        u16(1),
        pubkey(configAddress),
        pubkey(communityAddress),
        pubkey(identityAddress),
        pubkey(rootAuthority),
        u64(6n),
        u16(1),
        u16(2),
        bytes(32, 2),
        bytes(32, 3),
        u64(7n),
      ),
    ],
    [
      'community-membership-changed',
      eventData(
        SOCIAL_PROTOCOL_EVENT_LAYOUT.events.CommunityMembershipChanged,
        u16(1),
        pubkey(configAddress),
        pubkey(communityAddress),
        pubkey(publicKey(82)),
        pubkey(memberAddress),
        pubkey(identityAddress),
        pubkey(rootAuthority),
        u64(7n),
        u64(1n),
        u16(3),
        Uint8Array.of(1),
        u64(8n),
      ),
    ],
    [
      'reaction-changed',
      eventData(
        SOCIAL_PROTOCOL_EVENT_LAYOUT.events.ReactionStateChanged,
        u16(1),
        pubkey(configAddress),
        pubkey(publicKey(83)),
        pubkey(identityAddress),
        pubkey(postReference),
        pubkey(rootAuthority),
        Uint8Array.of(1),
        u64(8n),
        u64(1n),
        Uint8Array.of(1),
        u64(9n),
      ),
    ],
  ] as const)('decodes %s using its complete checked-in layout', (kind, encoded) => {
    expect(decodeAnchorEventLog(encoded)).toMatchObject({ kind, eventVersion: 1 });
  });

  it('rejects an unhandled discriminator instead of letting sync skip it', () => {
    expect(() => decodeAnchorEventLog(eventData([1, 2, 3, 4, 5, 6, 7, 8], u16(1)))).toThrow(
      'unsupported Anchor event discriminator',
    );
  });
});

describe('Phase-2 projection and authorization', () => {
  it('projects every state family, authorizes historical epochs, and rebuilds identically', async () => {
    const storage = new MemoryContentAddressedStorage();
    const projection = new MemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection)),
    );
    const builder = createPayloadBuilderIdentity(
      networkId,
      identityId,
      ed25519.getPublicKey(rootPrivateKey),
      'root',
    );
    const postContent: PostContent = {
      format: 'plain',
      body: 'Phase-2 replay anchor.',
      media: [],
      language: 'en',
      contentWarnings: [],
      accessibility: { altTextReminderAcknowledged: false, captionReferences: [] },
      visibility: { kind: 'public' },
      authorLabels: [],
      replyPolicy: 'anyone',
      quotePolicy: 'allowed',
    };
    const payload = buildPostPayload(builder, postContent, {
      createdAt: new Date('2026-07-28T15:03:00.000Z'),
      nonce: bytes(16, 20),
    });
    const envelope = signPayload(payload, rootPrivateKey);
    const receipt = await storage.put(canonicalizeEnvelope(envelope), {
      permanence: 'deletion-compatible',
    });

    const strategy1 = digest(11);
    const strategy2 = digest(12);
    const events: ProtocolEvent[] = [
      {
        ...base(1n, 1),
        type: 'protocol-initialized',
        configAddress,
      },
      {
        ...base(2n, 2, 0),
        type: 'identity-created',
        identityId,
        identityAddress,
        rootAuthority,
      },
      {
        ...base(2n, 3, 1),
        type: 'identity-created',
        identityId: memberIdentityId,
        identityAddress: memberAddress,
        rootAuthority: publicKey(79),
      },
      {
        ...base(3n, 4),
        type: 'post-published',
        identityId,
        authority: rootAuthority,
        postReference,
        objectId: getObjectId(payload),
        cid: receipt.cid,
        payloadHash: envelope.proof.payloadHash,
        sequence: 1n,
      },
      {
        ...base(4n, 5),
        type: 'delegation-created',
        identityId,
        delegationAddress: publicKey(80),
        delegateAuthority,
        delegationSequence: 1n,
        identitySequence: 2n,
        scopes: 3,
        issuedAtRootRotationCount: 0n,
        expiresAtSlot: 100n,
      },
      {
        ...base(5n, 6),
        type: 'block-changed',
        blockEdgeAddress: publicKey(81),
        blockerIdentityId: identityId,
        subjectIdentityId: memberIdentityId,
        authority: rootAuthority,
        blockerSequence: 3n,
        edgeStateSequence: 1n,
        active: true,
      },
      {
        ...base(6n, 7),
        type: 'community-created',
        communityAddress,
        creatorIdentityId: identityId,
        authority: rootAuthority,
        creatorSequence: 4n,
        manifestCid: receipt.cid,
        manifestHash: digest(10),
        governanceVersion: 1,
        governanceStrategyHash: strategy1,
      },
      {
        ...base(7n, 8),
        type: 'community-governance-updated',
        communityAddress,
        creatorIdentityId: identityId,
        authority: rootAuthority,
        creatorSequence: 5n,
        previousGovernanceVersion: 1,
        governanceVersion: 2,
        previousStrategyHash: strategy1,
        governanceStrategyHash: strategy2,
      },
      {
        ...base(8n, 9),
        type: 'community-membership-changed',
        communityAddress,
        membershipAddress: publicKey(82),
        memberIdentityId,
        assignedByIdentityId: identityId,
        authority: rootAuthority,
        authoritySequence: 6n,
        membershipStateSequence: 1n,
        roles: 3,
        active: true,
      },
      {
        ...base(9n, 10),
        type: 'reaction-changed',
        reactionReference: publicKey(83),
        reactorIdentityId: identityId,
        targetPostReference: postReference,
        authority: rootAuthority,
        reactionKind: 1,
        reactorSequence: 7n,
        reactionStateSequence: 1n,
        active: true,
      },
      {
        ...base(10n, 11),
        type: 'root-authority-rotated',
        identityId,
        previousRootAuthority: rootAuthority,
        newRootAuthority: nextRootAuthority,
        identitySequence: 8n,
        rotationCount: 1n,
      },
      {
        ...base(11n, 12),
        type: 'delegation-created',
        identityId,
        delegationAddress: publicKey(84),
        delegateAuthority: currentDelegateAuthority,
        delegationSequence: 2n,
        identitySequence: 9n,
        scopes: 1,
        issuedAtRootRotationCount: 1n,
        expiresAtSlot: 100n,
      },
      {
        ...base(12n, 13),
        type: 'delegation-revoked',
        identityId,
        delegationAddress: publicKey(84),
        delegateAuthority: currentDelegateAuthority,
        delegationSequence: 2n,
        identitySequence: 10n,
        delegationStateSequence: 2n,
      },
    ];

    for (const event of events) {
      await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
    }

    await expect(projection.getProtocolConfig(networkId)).resolves.toMatchObject({
      configAddress,
      initializedSlot: 1n,
    });
    await expect(projection.getBlock(identityId, memberIdentityId)).resolves.toMatchObject({
      active: true,
      stateSequence: 1n,
    });
    await expect(projection.getCommunity(networkId, communityAddress)).resolves.toMatchObject({
      governanceVersion: 2,
      governanceStrategyHash: strategy2,
      manifestVerified: false,
    });
    await expect(
      projection.getCommunityMemberships(networkId, communityAddress),
    ).resolves.toMatchObject([{ memberIdentityId, roles: 3, active: true }]);
    await expect(
      projection.getReactionsByPostReference(networkId, postReference),
    ).resolves.toMatchObject([{ reactionKind: 1, active: true }]);

    await expect(authorize(projection, rootAuthority, 'root', 'post', 3n, 4)).resolves.toBe(true);
    await expect(
      authorize(projection, delegateAuthority, 'delegation', 'profile', 9n, 10),
    ).resolves.toBe(true);
    await expect(
      authorize(projection, delegateAuthority, 'delegation', 'tombstone', 9n, 10),
    ).resolves.toBe(false);
    await expect(authorize(projection, rootAuthority, 'root', 'post', 11n, 12)).resolves.toBe(
      false,
    );
    await expect(authorize(projection, nextRootAuthority, 'root', 'post', 11n, 12)).resolves.toBe(
      true,
    );
    await expect(
      authorize(projection, delegateAuthority, 'delegation', 'profile', 11n, 12),
    ).resolves.toBe(false);
    await expect(
      authorize(projection, currentDelegateAuthority, 'delegation', 'profile', 11n, 12),
    ).resolves.toBe(true);
    await expect(
      authorize(projection, currentDelegateAuthority, 'delegation', 'profile', 12n, 13),
    ).resolves.toBe(false);

    const before = await snapshot(projection);
    const replay = await indexer.rebuild(networkId, [...events].reverse());
    expect(replay).toHaveLength(events.length);
    expect(replay.every((result) => result.applied)).toBe(true);
    await expect(snapshot(projection)).resolves.toEqual(before);
    const lastEvent = events.at(-1);
    if (lastEvent === undefined) {
      throw new Error('Expected the Phase-2 replay fixture to contain events.');
    }
    await expect(indexer.ingest(lastEvent)).resolves.toMatchObject({ applied: false });
  });

  it('rejects stale governance and delegation epochs without mutating state', async () => {
    const projection = new MemoryProjectionStore();
    await projection.apply({
      ...base(1n, 31),
      type: 'identity-created',
      identityId,
      identityAddress,
      rootAuthority,
    });
    await projection.apply({
      ...base(2n, 32),
      type: 'root-authority-rotated',
      identityId,
      previousRootAuthority: rootAuthority,
      newRootAuthority: nextRootAuthority,
      identitySequence: 1n,
      rotationCount: 1n,
    });
    await expect(
      projection.apply({
        ...base(3n, 33),
        type: 'delegation-created',
        identityId,
        delegationAddress: publicKey(90),
        delegateAuthority,
        delegationSequence: 1n,
        identitySequence: 2n,
        scopes: 1,
        issuedAtRootRotationCount: 0n,
        expiresAtSlot: 20n,
      }),
    ).rejects.toThrow('non-current root rotation epoch');
    await expect(projection.getDelegations(identityId)).resolves.toEqual([]);
  });

  it('uses finalized transaction indexes to resolve dependent same-slot replay order', async () => {
    const storage = new MemoryContentAddressedStorage();
    const projection = new MemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection)),
    );
    const identity: ProtocolEvent = {
      ...base(1n, 40),
      type: 'identity-created',
      identityId,
      identityAddress,
      rootAuthority,
    };
    const rotation: ProtocolEvent = {
      ...base(2n, 99, 0),
      type: 'root-authority-rotated',
      identityId,
      previousRootAuthority: rootAuthority,
      newRootAuthority: nextRootAuthority,
      identitySequence: 1n,
      rotationCount: 1n,
    };
    const delegation: ProtocolEvent = {
      ...base(2n, 1, 1),
      type: 'delegation-created',
      identityId,
      delegationAddress: publicKey(91),
      delegateAuthority,
      delegationSequence: 1n,
      identitySequence: 2n,
      scopes: 1,
      issuedAtRootRotationCount: 1n,
      expiresAtSlot: 20n,
    };

    await expect(
      indexer.rebuild(networkId, [delegation, rotation, identity]),
    ).resolves.toHaveLength(3);
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      rootAuthority: nextRootAuthority,
      rootRotationCount: 1n,
    });
    await expect(projection.getDelegations(identityId)).resolves.toMatchObject([
      { issuedAtRootRotationCount: 1n },
    ]);
  });
});

async function snapshot(projection: MemoryProjectionStore) {
  return {
    identity: await projection.getIdentity(identityId),
    delegations: await projection.getDelegations(identityId),
    block: await projection.getBlock(identityId, memberIdentityId),
    community: await projection.getCommunity(networkId, communityAddress),
    memberships: await projection.getCommunityMemberships(networkId, communityAddress),
    reactions: await projection.getReactionsByPostReference(networkId, postReference),
    checkpoint: await projection.checkpoint(networkId),
  };
}

function authorize(
  projection: MemoryProjectionStore,
  authority: string,
  kind: 'root' | 'delegation',
  objectType: string,
  slot: bigint,
  signatureSeed: number,
) {
  return projection.authorizeSigningKey({
    identityId,
    authority,
    kind,
    objectType,
    slot,
    transactionSignature: signature(signatureSeed),
    logIndex: 0,
  });
}

function base(slot: bigint, signatureSeed: number, transactionIndex?: number) {
  return {
    networkId,
    programId,
    transactionSignature: signature(signatureSeed),
    ...(transactionIndex === undefined ? {} : { transactionIndex }),
    slot,
    logIndex: 0,
    blockTime: `2026-07-28T15:${slot.toString().padStart(2, '0')}:00.000Z`,
    finalized: true as const,
  };
}

function signature(seed: number): string {
  return bs58.encode(bytes(64, seed));
}

function publicKey(seed: number): string {
  return bs58.encode(bytes(32, seed));
}

function digest(seed: number): string {
  return encodeMultibaseBase64Url(bytes(32, seed));
}

function fakeCid(): string {
  return `b${'a'.repeat(58)}`;
}

function eventData(discriminator: readonly number[], ...fields: readonly Uint8Array[]): string {
  return Buffer.concat([
    Buffer.from(discriminator),
    ...fields.map((field) => Buffer.from(field)),
  ]).toString('base64');
}

function u16(value: number): Uint8Array {
  const result = new Uint8Array(2);
  new DataView(result.buffer).setUint16(0, value, true);
  return result;
}

function u64(value: bigint): Uint8Array {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, value, true);
  return result;
}

function borshString(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, encoded.byteLength, true);
  return Uint8Array.from([...length, ...encoded]);
}

function pubkey(value: string): Uint8Array {
  return bs58.decode(value);
}

function bytes(length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (seed + index) % 256);
}
