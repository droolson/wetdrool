import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import {
  communityGovernanceStrategyCommitment,
  encodeMultibaseBase64Url,
  WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  type CommunityContent,
  type NetworkId,
  type PostContent,
  type ProfileContent,
} from '@wetdrool/protocol';

import {
  MemoryProjectionStore,
  type ManifestDeferral,
  type ProtocolEvent,
  type VerifiedManifest,
} from '../src/index.js';

const genesis = publicKey(1);
const programId = publicKey(2);
const identityAddress = publicKey(3);
const networkId = `droolnet:v1:${genesis}:${programId}` as NetworkId;
const identityId = `wetdroolid:v1:${networkId}:${identityAddress}`;
const rootAuthority = publicKey(4);
const configAddress = publicKey(6);
const retryAt = '2026-07-28T12:05:00.000Z';

describe('memory pending manifest disposition', () => {
  it('returns due pending records in bounded retry and event order and reschedules exactly', async () => {
    const projection = await seededProjection();
    const first = profileItem(1n, 2n, 8, 'First pending profile');
    const second = postItem(2n, 3n, 9, 'Second pending object');
    await projection.deferManifestEvent(first.event, {
      ...deferral(),
      eventBody: { encodedData: 'first' },
    });
    await projection.deferManifestEvent(second.event, {
      ...deferral(),
      eventBody: { encodedData: 'second' },
    });

    await expect(
      projection.duePendingManifestEvents(networkId, '2026-07-28T12:04:59.999Z', 10),
    ).resolves.toEqual([]);
    await expect(projection.duePendingManifestEvents(networkId, retryAt, 1)).resolves.toEqual([
      {
        event: first.event,
        attempts: 1,
        eventBody: { encodedData: 'first' },
        failureDetail: 'The referenced content is temporarily unavailable.',
        nextAttemptAt: retryAt,
      },
    ]);
    await expect(projection.duePendingManifestEvents(networkId, retryAt, 0)).rejects.toThrow(
      'between 1 and 1,000',
    );

    await expect(
      projection.reschedulePendingManifestEvent(first.event, {
        ...deferral(),
        eventBody: { encodedData: 'first-retry' },
        nextAttemptAt: '2026-07-28T12:10:00.000Z',
      }),
    ).resolves.toEqual({
      attempts: 2,
      nextAttemptAt: '2026-07-28T12:10:00.000Z',
    });
    await expect(projection.duePendingManifestEvents(networkId, retryAt, 10)).resolves.toEqual([
      {
        event: second.event,
        attempts: 1,
        eventBody: { encodedData: 'second' },
        failureDetail: 'The referenced content is temporarily unavailable.',
        nextAttemptAt: retryAt,
      },
    ]);

    await projection.promoteManifestEvent(second.event, second.manifest);
    await expect(
      projection.reschedulePendingManifestEvent(second.event, {
        ...deferral(),
        nextAttemptAt: '2026-07-28T12:11:00.000Z',
      }),
    ).resolves.toBeUndefined();
    await expect(
      projection.deadLetter(networkId, second.event.transactionSignature, second.event.logIndex),
    ).resolves.toBeUndefined();

    const rebuiltRetryAt = '2026-07-28T12:20:00.000Z';
    const rebuiltDeferral = {
      ...deferral(),
      eventBody: { encodedData: 'first-rebuilt' },
      failureDetail: 'Rebuilt retry metadata replaces the previous scheduling payload.',
      nextAttemptAt: rebuiltRetryAt,
    };
    await projection.rebuildProjection(networkId, [
      { event: identityCreated() },
      { event: first.event, pendingManifest: rebuiltDeferral },
      { event: second.event, manifest: second.manifest },
    ]);
    await expect(projection.duePendingManifestEvents(networkId, retryAt, 10)).resolves.toEqual([]);
    await expect(
      projection.deadLetter(networkId, first.event.transactionSignature, first.event.logIndex),
    ).resolves.toEqual({ attempts: 2, nextAttemptAt: rebuiltRetryAt });
    await expect(
      projection.duePendingManifestEvents(networkId, rebuiltRetryAt, 10),
    ).resolves.toEqual([
      {
        event: first.event,
        attempts: 2,
        eventBody: { encodedData: 'first-rebuilt' },
        failureDetail: 'Rebuilt retry metadata replaces the previous scheduling payload.',
        nextAttemptAt: rebuiltRetryAt,
      },
    ]);
  });

  it('durably defers an unavailable profile while advancing liveness exactly once', async () => {
    const projection = await seededProjection();
    const current = profileItem(1n, 2n, 10, 'Current profile');
    await projection.apply(current.event, current.manifest);

    const pending = profileItem(2n, 3n, 11, 'Pending profile');
    await expect(projection.deferManifestEvent(pending.event, deferral())).resolves.toBe(true);

    await expect(projection.manifestEventDisposition(pending.event)).resolves.toEqual({
      state: 'pending',
    });
    await expect(projection.getProfile(identityId)).resolves.toBeUndefined();
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 2n,
      updatedSlot: 3n,
    });
    await expect(projection.checkpoint(networkId)).resolves.toBe(3n);
    await expect(
      projection.deadLetter(networkId, pending.event.transactionSignature, pending.event.logIndex),
    ).resolves.toEqual({
      attempts: 1,
      nextAttemptAt: retryAt,
    });

    await expect(projection.deferManifestEvent(pending.event, deferral())).resolves.toBe(false);
    await expect(
      projection.deadLetter(networkId, pending.event.transactionSignature, pending.event.logIndex),
    ).resolves.toMatchObject({ attempts: 1 });
    await expect(projection.apply(pending.event, pending.manifest)).rejects.toMatchObject({
      code: 'event-conflict',
    });
    await expect(
      projection.manifestEventDisposition({
        ...pending.event,
        blockTime: '2026-07-28T12:00:59.000Z',
      }),
    ).rejects.toMatchObject({ code: 'event-conflict' });
  });

  it('promotes verified content without re-advancing and never resurrects a superseded profile', async () => {
    const projection = await seededProjection();
    const first = profileItem(1n, 2n, 20, 'First profile');
    const pending = profileItem(2n, 3n, 21, 'Temporarily unavailable');
    const latest = profileItem(3n, 4n, 22, 'Latest profile');
    await projection.apply(first.event, first.manifest);
    await projection.deferManifestEvent(pending.event, deferral());
    await projection.apply(latest.event, latest.manifest);

    await expect(projection.promoteManifestEvent(pending.event, pending.manifest)).resolves.toBe(
      true,
    );
    await expect(projection.manifestEventDisposition(pending.event)).resolves.toEqual({
      state: 'accepted',
    });
    await expect(projection.getProfile(identityId)).resolves.toMatchObject({
      objectId: latest.event.objectId,
      content: { displayName: 'Latest profile' },
    });
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 3n,
      updatedSlot: 4n,
    });
    await expect(projection.checkpoint(networkId)).resolves.toBe(4n);
    await expect(
      projection.deadLetter(networkId, pending.event.transactionSignature, pending.event.logIndex),
    ).resolves.toBeUndefined();
    await expect(projection.promoteManifestEvent(pending.event, pending.manifest)).resolves.toBe(
      false,
    );
    await expect(projection.deferManifestEvent(pending.event, deferral())).rejects.toMatchObject({
      code: 'event-conflict',
    });
    await expect(
      projection.rejectPendingManifestEvent(pending.event, {
        eventBody: {},
        failureCode: 'manifest-invalid',
        failureDetail: 'An accepted disposition cannot be reclassified.',
      }),
    ).rejects.toMatchObject({ code: 'event-conflict' });
  });

  it('retains a pending profile promoted after identity deactivation without public discovery', async () => {
    const projection = new MemoryProjectionStore();
    const initialized: ProtocolEvent = {
      ...eventBase(0n, 23),
      type: 'protocol-initialized',
      configAddress,
    };
    const created = identityCreated();
    const pending = profileItem(1n, 2n, 24, 'Retained historical profile');
    const deactivated: ProtocolEvent = {
      ...eventBase(3n, 25),
      type: 'identity-deactivated',
      configAddress,
      identityId,
      identityAddress,
      rootAuthority,
      identitySequence: 2n,
    };

    await projection.apply(initialized);
    await projection.apply(created);
    await projection.deferManifestEvent(pending.event, deferral());
    await projection.apply(deactivated);
    await expect(projection.promoteManifestEvent(pending.event, pending.manifest)).resolves.toBe(
      true,
    );

    await expect(projection.getProfile(identityId)).resolves.toMatchObject({
      objectId: pending.event.objectId,
      content: { displayName: 'Retained historical profile' },
    });
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      active: false,
      identitySequence: 2n,
    });
    await expect(
      projection.searchPublic({
        networkId,
        term: 'Retained historical profile',
        limit: 10,
      }),
    ).resolves.toMatchObject({ results: [] });

    await projection.rebuildProjection(networkId, [
      { event: initialized },
      { event: created },
      { event: pending.event, manifest: pending.manifest },
      { event: deactivated },
    ]);
    await expect(projection.getProfile(identityId)).resolves.toMatchObject({
      objectId: pending.event.objectId,
      content: { displayName: 'Retained historical profile' },
    });
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      active: false,
      identitySequence: 2n,
    });
  });

  it('keeps a deferred post private and preserves its later tombstone through promotion and rebuild', async () => {
    const projection = await seededProjection();
    const pending = postItem(1n, 2n, 30, 'Must never reappear in a feed');
    await projection.deferManifestEvent(pending.event, deferral());

    await expect(projection.getPost(pending.event.objectId)).resolves.toBeUndefined();
    await expect(
      projection.findPostObjectIdByReference(networkId, pending.event.postReference),
    ).resolves.toBe(pending.event.objectId);
    await expect(
      projection.getFeed({ networkId, mode: 'chronological', limit: 20 }),
    ).resolves.toEqual([]);

    const tombstone: ProtocolEvent = {
      ...eventBase(3n, 31),
      type: 'tombstoned',
      identityId,
      targetPostReference: pending.event.postReference,
      targetObjectId: pending.event.objectId,
      sequence: 2n,
    };
    await projection.apply(tombstone);
    await projection.rebuildProjection(networkId, [
      { event: identityCreated() },
      { event: pending.event, pendingManifest: deferral() },
      { event: tombstone },
    ]);

    await expect(projection.promoteManifestEvent(pending.event, pending.manifest)).resolves.toBe(
      true,
    );
    await expect(projection.getPost(pending.event.objectId)).resolves.toMatchObject({
      tombstonedAt: tombstone.blockTime,
    });
    await expect(
      projection.getFeed({ networkId, mode: 'chronological', limit: 20 }),
    ).resolves.toEqual([]);
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 2n,
    });
    await expect(projection.checkpoint(networkId)).resolves.toBe(3n);
  });

  it('atomically transitions pending to immutable terminal without sequence replay', async () => {
    const projection = await seededProjection();
    const pending = postItem(1n, 2n, 40, 'Invalid after retrieval');
    await projection.deferManifestEvent(pending.event, deferral());
    const rejection = {
      eventBody: {},
      failureCode: 'manifest-invalid' as const,
      failureDetail: 'The retrieved bytes are not a canonical signed envelope.',
    };

    await expect(projection.rejectPendingManifestEvent(pending.event, rejection)).resolves.toBe(
      true,
    );
    await expect(projection.manifestEventDisposition(pending.event)).resolves.toEqual({
      state: 'terminal',
      failureCode: 'manifest-invalid',
    });
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 1n,
      updatedSlot: 2n,
    });
    await expect(projection.checkpoint(networkId)).resolves.toBe(2n);
    await expect(
      projection.deadLetter(networkId, pending.event.transactionSignature, pending.event.logIndex),
    ).resolves.toEqual({
      attempts: 1,
      terminalFailureCode: 'manifest-invalid',
    });

    await projection.resolveDeadLetter(
      networkId,
      pending.event.transactionSignature,
      pending.event.logIndex,
    );
    await expect(
      projection.deadLetter(networkId, pending.event.transactionSignature, pending.event.logIndex),
    ).resolves.toMatchObject({ terminalFailureCode: 'manifest-invalid' });
    await expect(projection.rejectPendingManifestEvent(pending.event, rejection)).resolves.toBe(
      false,
    );
    await expect(
      projection.rejectPendingManifestEvent(pending.event, {
        ...rejection,
        failureCode: 'hash-mismatch',
      }),
    ).rejects.toMatchObject({ code: 'event-conflict' });
    await expect(
      projection.promoteManifestEvent(pending.event, pending.manifest),
    ).rejects.toMatchObject({ code: 'event-conflict' });
    await expect(projection.apply(pending.event, pending.manifest)).rejects.toMatchObject({
      code: 'event-conflict',
    });
  });

  it('recognizes accepted raw duplicates and rolls back an invalid sequence deferral', async () => {
    const projection = await seededProjection();
    const identity = identityCreated();
    await expect(projection.manifestEventDisposition(identity)).resolves.toEqual({
      state: 'accepted',
    });

    const skipped = postItem(2n, 2n, 50, 'Sequence two cannot be the first mutation');
    await expect(projection.deferManifestEvent(skipped.event, deferral())).rejects.toMatchObject({
      code: 'stale-event',
    });
    await expect(projection.manifestEventDisposition(skipped.event)).resolves.toBeUndefined();
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 0n,
    });
    await expect(projection.checkpoint(networkId)).resolves.toBe(1n);
    await expect(
      projection.deadLetter(networkId, skipped.event.transactionSignature, skipped.event.logIndex),
    ).resolves.toBeUndefined();
  });

  it('retains a private shell across community retry, promotion, quarantine, and rebuild paths', async () => {
    const projection = await seededProjection();
    const pending = communityItem(1n, 2n, 60, 'public');
    await expect(projection.deferManifestEvent(pending.event, deferral())).resolves.toBe(true);
    await expect(
      projection.getCommunity(networkId, pending.event.communityAddress),
    ).resolves.toMatchObject({
      manifestVerified: false,
      manifestGovernanceVersion: 1,
      manifestGovernanceStrategyHash: pending.event.governanceStrategyHash,
    });
    await expect(projection.listPublicCommunities({ networkId, limit: 10 })).resolves.toMatchObject(
      { communities: [] },
    );

    await expect(projection.promoteManifestEvent(pending.event, pending.manifest)).resolves.toBe(
      true,
    );
    await expect(
      projection.getCommunity(networkId, pending.event.communityAddress),
    ).resolves.toMatchObject({
      manifestVerified: true,
      objectId: pending.manifest.objectId,
      content: { name: 'Community 60' },
    });
    await expect(projection.listPublicCommunities({ networkId, limit: 10 })).resolves.toMatchObject(
      {
        communities: [{ communityAddress: pending.event.communityAddress }],
      },
    );
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 1n,
    });

    await projection.rebuildProjection(networkId, [
      { event: identityCreated() },
      { event: pending.event, manifest: pending.manifest },
    ]);
    await expect(
      projection.getCommunity(networkId, pending.event.communityAddress),
    ).resolves.toMatchObject({ manifestVerified: true, content: { name: 'Community 60' } });

    const quarantinedProjection = await seededProjection();
    const quarantined = communityItem(1n, 2n, 61, 'private');
    await quarantinedProjection.quarantineManifestEvent(quarantined.event, {
      eventBody: {},
      failureCode: 'manifest-invalid',
      failureDetail: 'Invalid signed community bytes.',
    });
    await expect(
      quarantinedProjection.getCommunity(networkId, quarantined.event.communityAddress),
    ).resolves.toMatchObject({ manifestVerified: false });
    await expect(
      quarantinedProjection.listPublicCommunities({ networkId, limit: 10 }),
    ).resolves.toMatchObject({ communities: [] });
    await quarantinedProjection.rebuildProjection(networkId, [
      { event: identityCreated() },
      { event: quarantined.event, terminalFailureCode: 'manifest-invalid' },
    ]);
    await expect(
      quarantinedProjection.getCommunity(networkId, quarantined.event.communityAddress),
    ).resolves.toMatchObject({ manifestVerified: false });
  });

  it('paginates equal-slot mixed-case addresses in raw ASCII order', async () => {
    const projection = await seededProjection();
    const rawHigherAddress = publicKey(1);
    const rawLowerAddress = publicKey(52);
    expect(rawHigherAddress).toMatch(/[A-Z]/u);
    expect(rawHigherAddress).toMatch(/[a-z]/u);
    expect(rawLowerAddress).toMatch(/[A-Z]/u);
    expect(rawLowerAddress).toMatch(/[a-z]/u);
    expect(rawHigherAddress > rawLowerAddress).toBe(true);

    const first = communityItem(1n, 2n, 62, 'public');
    const second = communityItem(2n, 2n, 63, 'public');
    await projection.apply(
      { ...first.event, communityAddress: rawHigherAddress, transactionIndex: 0 },
      first.manifest,
    );
    await projection.apply(
      { ...second.event, communityAddress: rawLowerAddress, transactionIndex: 1 },
      second.manifest,
    );

    const firstPage = await projection.listPublicCommunities({ networkId, limit: 1 });
    expect(firstPage).toMatchObject({
      communities: [{ communityAddress: rawHigherAddress }],
      next: { createdSlot: 2n, communityAddress: rawHigherAddress },
    });
    if (firstPage.next === undefined) throw new Error('Expected a second directory page.');
    await expect(
      projection.listPublicCommunities({
        networkId,
        limit: 1,
        before: firstPage.next,
      }),
    ).resolves.toMatchObject({
      communities: [{ communityAddress: rawLowerAddress }],
    });
  });
});

async function seededProjection(): Promise<MemoryProjectionStore> {
  const projection = new MemoryProjectionStore();
  await projection.apply(identityCreated());
  return projection;
}

function identityCreated(): ProtocolEvent {
  return {
    ...eventBase(1n, 5),
    type: 'identity-created',
    identityId,
    identityAddress,
    rootAuthority,
  };
}

function profileItem(sequence: bigint, slot: bigint, signatureSeed: number, displayName: string) {
  const event = {
    ...eventBase(slot, signatureSeed),
    type: 'profile-updated' as const,
    identityId,
    objectId: objectId('profile', signatureSeed),
    cid: cid(signatureSeed),
    payloadHash: digest(signatureSeed),
    sequence,
    profileSchemaVersion: 2,
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
    manifest: manifest(event, 'profile', content),
  };
}

function postItem(sequence: bigint, slot: bigint, signatureSeed: number, body: string) {
  const event = {
    ...eventBase(slot, signatureSeed),
    type: 'post-published' as const,
    identityId,
    postReference: publicKey(signatureSeed + 80),
    objectId: objectId('post', signatureSeed),
    cid: cid(signatureSeed),
    payloadHash: digest(signatureSeed),
    sequence,
  };
  const content = {
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
  } satisfies PostContent;
  return {
    event,
    manifest: manifest(event, 'post', content),
  };
}

function communityItem(
  sequence: bigint,
  slot: bigint,
  signatureSeed: number,
  visibility: Exclude<CommunityContent['visibility'], 'restricted'>,
) {
  const strategy = communityGovernanceStrategyCommitment({
    governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  });
  const event = {
    ...eventBase(slot, signatureSeed),
    type: 'community-created' as const,
    communityAddress: publicKey(signatureSeed + 90),
    creatorIdentityId: identityId,
    authority: rootAuthority,
    communityNonce: encodeMultibaseBase64Url(
      Uint8Array.from({ length: 16 }, (_, index) => signatureSeed + index),
    ),
    creatorSequence: sequence,
    manifestCid: cid(signatureSeed),
    manifestHash: digest(signatureSeed),
    governanceVersion: strategy.governanceVersion,
    governanceStrategyHash: strategy.digest,
    visibility,
    membershipPolicy: 'open' as const,
    membershipPolicySequence: 1n,
    membershipSequence: 0n,
  };
  const content = {
    slug: `community-${String(signatureSeed)}`,
    name: `Community ${String(signatureSeed)}`,
    description: 'A retry-path fixture.',
    visibility,
    membershipPolicy: 'open',
    governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
    federationPolicy: { mode: 'open', allow: [], block: [] },
    replacement: { sequence: 1 },
  } satisfies CommunityContent;
  return {
    event,
    manifest: {
      objectId: objectId('community', signatureSeed),
      cid: event.manifestCid,
      payloadHash: event.manifestHash,
      schemaVersion: 2 as const,
      signingKeyId: `${identityId}#root/${rootAuthority}`,
      authorIdentityId: identityId,
      createdAt: event.blockTime,
      type: 'community' as const,
      content,
    } satisfies VerifiedManifest,
  };
}

function manifest(
  event: {
    readonly objectId: string;
    readonly cid: string;
    readonly payloadHash: string;
    readonly blockTime: string;
  },
  type: 'profile' | 'post',
  content: ProfileContent | PostContent,
): VerifiedManifest {
  return {
    objectId: event.objectId,
    cid: event.cid,
    payloadHash: event.payloadHash,
    schemaVersion: 2,
    signingKeyId: `${identityId}#root/${rootAuthority}`,
    authorIdentityId: identityId,
    createdAt: event.blockTime,
    type,
    content,
  };
}

function deferral(): ManifestDeferral {
  return {
    eventBody: {},
    failureCode: 'manifest-unavailable',
    failureDetail: 'The referenced content is temporarily unavailable.',
    nextAttemptAt: retryAt,
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

function objectId(type: 'community' | 'profile' | 'post', seed: number): string {
  return `wetdroolobj:v1:${type}:${digest(seed)}`;
}

function digest(seed: number): string {
  return `u${Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => seed + index)).toString(
    'base64url',
  )}`;
}

function cid(seed: number): string {
  void seed;
  return 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
}

function publicKey(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 32 }, (_, index) => ((seed + index) % 255) + 1));
}

function signature(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 64 }, (_, index) => ((seed + index) % 255) + 1));
}
