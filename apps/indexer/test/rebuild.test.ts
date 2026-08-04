import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import { encodeMultibaseBase64Url, type NetworkId } from '@wetdrool/protocol';
import { MemoryContentAddressedStorage } from '@wetdrool/storage';
import { createProtocolFixtureSet } from '@wetdrool/test-fixtures';

import {
  decodeRawProtocolEventRow,
  IndexerRebuildError,
  MemoryProjectionStore,
  prepareIndexerRebuild,
  rawEventCoordinateKey,
  type ProjectionRebuildTarget,
  type ProtocolEvent,
  validateAndMaybeApplyIndexerRebuild,
} from '../src/index.js';
import { TEST_CID } from './cid-fixtures.js';
import { parseRebuildCliArguments, rebuildConfirmationToken } from '../src/rebuild-cli.js';

const genesisHash = publicKey(1);
const programId = publicKey(2);
const networkId = `droolnet:v1:${genesisHash}:${programId}` as NetworkId;
const identityAddress = publicKey(3);
const identityId = `wetdroolid:v1:${networkId}:${identityAddress}`;
const rootAuthority = publicKey(4);

describe('indexer rebuild command', () => {
  it('defaults to dry-run and requires the network-specific confirmation for apply', () => {
    expect(parseRebuildCliArguments(['--network', networkId])).toEqual({
      help: false,
      networkId,
      apply: false,
    });
    expect(
      parseRebuildCliArguments([
        '--network',
        networkId,
        '--apply',
        '--confirm',
        rebuildConfirmationToken(networkId),
      ]),
    ).toEqual({
      help: false,
      networkId,
      apply: true,
    });

    expect(() => parseRebuildCliArguments(['--network', networkId, '--apply'])).toThrow(
      'Apply mode requires --confirm',
    );
    expect(() =>
      parseRebuildCliArguments([
        '--network',
        networkId,
        '--apply',
        '--confirm',
        'rebuild:another-network',
      ]),
    ).toThrow('Apply mode requires --confirm');
    expect(() => parseRebuildCliArguments(['--network', networkId, '--confirm', 'unused'])).toThrow(
      '--confirm is accepted only with --apply',
    );
    expect(() =>
      parseRebuildCliArguments(['--network', networkId, '--apply', '--dry-run']),
    ).toThrow('--apply and --dry-run cannot be combined');
    expect(() => parseRebuildCliArguments(['--network', networkId, '--unknown'])).toThrow(
      'Unknown indexer rebuild option',
    );
  });

  it('hydrates canonical bigint fields and verifies immutable row metadata', () => {
    const event: ProtocolEvent = {
      ...baseEvent(2n, 9),
      type: 'root-authority-rotated',
      identityId,
      previousRootAuthority: rootAuthority,
      newRootAuthority: publicKey(5),
      identitySequence: 2n,
      rotationCount: 1n,
    };
    const row = rawRow(event);

    expect(decodeRawProtocolEventRow(row)).toEqual(event);
    expect(() =>
      decodeRawProtocolEventRow({
        ...row,
        event_type: 'identity-created',
      }),
    ).toThrow('metadata does not exactly match');
    expect(() =>
      decodeRawProtocolEventRow({
        ...row,
        event_body: {
          ...(row.event_body as Readonly<Record<string, unknown>>),
          identitySequence: '02',
        },
      }),
    ).toThrow('must be a canonical unsigned integer');
  });

  it('sorts and validates the complete ledger in a deterministic shadow projection', async () => {
    const events = durableEvents();
    const get = vi.fn(async () => new Uint8Array());
    const source = { get };

    const ordered = await prepareIndexerRebuild(networkId, events, source);
    const reversed = await prepareIndexerRebuild(networkId, [...events].reverse(), source);

    expect(ordered).toMatchObject({
      networkId,
      eventCount: 2,
      firstSlot: '1',
      lastSlot: '2',
      ledgerSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(ordered.items.map(({ event }) => event.type)).toEqual([
      'protocol-initialized',
      'identity-created',
    ]);
    expect(reversed.ledgerSha256).toBe(ordered.ledgerSha256);
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps a dry run read-only and invokes the atomic target only in apply mode', async () => {
    const events = durableEvents();
    const source = new MemoryContentAddressedStorage();
    const rebuildProjection = vi.fn<ProjectionRebuildTarget['rebuildProjection']>(
      async () => undefined,
    );
    const target = { rebuildProjection };

    await expect(
      validateAndMaybeApplyIndexerRebuild({
        networkId,
        events,
        source,
        apply: false,
        target,
      }),
    ).resolves.toMatchObject({ mode: 'dry-run', eventCount: 2 });
    expect(rebuildProjection).not.toHaveBeenCalled();

    await expect(
      validateAndMaybeApplyIndexerRebuild({
        networkId,
        events,
        source,
        apply: true,
        target,
      }),
    ).resolves.toMatchObject({ mode: 'applied', eventCount: 2 });
    expect(rebuildProjection).toHaveBeenCalledOnce();
    expect(rebuildProjection).toHaveBeenCalledWith(
      networkId,
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({ type: 'protocol-initialized' }),
        }),
        expect.objectContaining({
          event: expect.objectContaining({ type: 'identity-created' }),
        }),
      ]),
    );
  });

  it('reverifies and sanitizes an immutable signed profile-v1 fixture during rebuild', async () => {
    const fixtures = createProtocolFixtureSet();
    const fixtureIdentity = fixtures.participants.alice;
    const historicalProfile = fixtures.manifests.aliceProfileV1;
    const fixtureProgramId = fixtures.network.split(':').at(-1);
    const fixtureIdentityAddress = fixtureIdentity.author.split(':').at(-1);
    if (fixtureProgramId === undefined || fixtureIdentityAddress === undefined) {
      throw new Error('The historical fixture identifiers are malformed.');
    }

    const source = new MemoryContentAddressedStorage();
    const receipt = await source.put(historicalProfile.canonicalBytes, {
      permanence: 'deletion-compatible',
    });
    const delegateAuthority = bs58.encode(fixtureIdentity.publicKey);
    const events: readonly ProtocolEvent[] = [
      {
        networkId: fixtures.network,
        programId: fixtureProgramId,
        transactionSignature: transactionSignature(93),
        transactionIndex: 0,
        slot: 1n,
        logIndex: 0,
        blockTime: '2026-07-28T12:00:01.000Z',
        finalized: true,
        type: 'identity-created',
        identityId: fixtureIdentity.author,
        identityAddress: fixtureIdentityAddress,
        rootAuthority: publicKey(93),
      },
      {
        networkId: fixtures.network,
        programId: fixtureProgramId,
        transactionSignature: transactionSignature(94),
        transactionIndex: 0,
        slot: 2n,
        logIndex: 0,
        blockTime: '2026-07-28T12:00:02.000Z',
        finalized: true,
        type: 'delegation-created',
        identityId: fixtureIdentity.author,
        delegationAddress: publicKey(94),
        delegateAuthority,
        delegationSequence: 1n,
        identitySequence: 1n,
        scopes: 1,
        issuedAtRootRotationCount: 0n,
        expiresAtSlot: 100n,
      },
      {
        networkId: fixtures.network,
        programId: fixtureProgramId,
        transactionSignature: transactionSignature(95),
        transactionIndex: 0,
        slot: 3n,
        logIndex: 0,
        blockTime: '2026-07-28T12:00:03.000Z',
        finalized: true,
        type: 'profile-updated',
        identityId: fixtureIdentity.author,
        authority: delegateAuthority,
        objectId: historicalProfile.objectId,
        cid: receipt.cid,
        payloadHash: historicalProfile.envelope.proof.payloadHash,
        sequence: 2n,
      },
    ];
    const target = new MemoryProjectionStore();
    const historicalTarget = new MemoryProjectionStore();

    try {
      const terminal = await prepareIndexerRebuild(fixtures.network, events, source, 50_000, 3n);
      expect(terminal.items.at(-1)).toMatchObject({
        event: { type: 'profile-updated' },
        terminalFailureCode: 'schema-version',
      });
      for (const item of terminal.items) {
        if (item.terminalFailureCode === undefined) {
          await target.apply(item.event, item.manifest);
        } else {
          await target.quarantineManifestEvent(item.event, {
            eventBody: {},
            failureCode: item.terminalFailureCode,
            failureDetail: 'test terminal replay',
          });
        }
      }
      await expect(target.getProfile(fixtureIdentity.author)).resolves.toBeUndefined();
      await expect(target.getIdentity(fixtureIdentity.author)).resolves.toMatchObject({
        identitySequence: 2n,
      });
      await expect(
        validateAndMaybeApplyIndexerRebuild({
          networkId: fixtures.network,
          events,
          source,
          apply: true,
          target,
          profileSchemaV2ActivationSlot: 3n,
        }),
      ).resolves.toMatchObject({ mode: 'applied', eventCount: 3 });
      await expect(
        validateAndMaybeApplyIndexerRebuild({
          networkId: fixtures.network,
          events,
          source,
          apply: true,
          target,
          profileSchemaV2ActivationSlot: 4n,
        }),
      ).rejects.toMatchObject({ code: 'event-conflict' });

      const durablyAccepted = new Map(
        events.map((event) => [rawEventCoordinateKey(event), { state: 'accepted' as const }]),
      );
      await expect(
        prepareIndexerRebuild(
          fixtures.network,
          events,
          source,
          50_000,
          3n,
          new Map(),
          durablyAccepted,
        ),
      ).rejects.toThrow('refusing disposition drift');

      const prepared = await prepareIndexerRebuild(fixtures.network, events, source, 50_000, 4n);
      expect(prepared.items.at(-1)?.manifest).toMatchObject({
        schemaVersion: 1,
        objectId: historicalProfile.objectId,
      });
      for (const item of prepared.items) {
        await historicalTarget.apply(item.event, item.manifest);
      }

      await validateAndMaybeApplyIndexerRebuild({
        networkId: fixtures.network,
        events,
        source,
        apply: true,
        target: historicalTarget,
        profileSchemaV2ActivationSlot: 4n,
      });

      await expect(historicalTarget.getProfile(fixtureIdentity.author)).resolves.toMatchObject({
        content: {
          displayName: 'Alice Example',
          pronouns: [{ visibility: 'public', value: 'she/her' }],
          chosenFamilyLabels: [],
        },
      });
      const rebuiltProfile = await historicalTarget.getProfile(fixtureIdentity.author);
      expect(JSON.stringify(rebuiltProfile?.content)).not.toContain('genderVisibility');

      const unavailable = { get: vi.fn(() => Promise.reject(new Error('content offline'))) };
      const terminalFailureCodes = new Map([
        [rawEventCoordinateKey(events[2] as ProtocolEvent), 'schema-version' as const],
      ]);
      await expect(
        prepareIndexerRebuild(
          fixtures.network,
          events,
          unavailable,
          50_000,
          4n,
          terminalFailureCodes,
        ),
      ).resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ terminalFailureCode: 'schema-version' }),
        ]),
      });
      expect(unavailable.get).not.toHaveBeenCalled();
    } finally {
      await Promise.all([target.close(), historicalTarget.close()]);
    }
  });

  it('never reaches the live target when shadow manifest verification fails', async () => {
    const rebuildProjection = vi.fn<ProjectionRebuildTarget['rebuildProjection']>(
      async () => undefined,
    );
    const events: readonly ProtocolEvent[] = [
      ...durableEvents(),
      {
        ...baseEvent(3n, 13),
        type: 'post-published',
        identityId,
        objectId: `wetdroolobj:v1:post:${digest(14)}`,
        cid: TEST_CID,
        payloadHash: digest(15),
        sequence: 1n,
      },
    ];

    await expect(
      validateAndMaybeApplyIndexerRebuild({
        networkId,
        events,
        source: new MemoryContentAddressedStorage(),
        apply: true,
        target: { rebuildProjection },
      }),
    ).rejects.toThrow('could not be retrieved and verified');
    expect(rebuildProjection).not.toHaveBeenCalled();
  });

  it('derives accepted post suppression from the complete durable event order without content I/O', async () => {
    const projection = new MemoryProjectionStore();
    const [initialized, created] = durableEvents();
    if (initialized === undefined || created === undefined) {
      throw new Error('Expected durable event fixtures.');
    }
    const postReference = publicKey(40);
    const post: ProtocolEvent = {
      ...baseEvent(3n, 41),
      type: 'post-published',
      identityId,
      postReference,
      objectId: `wetdroolobj:v1:post:${digest(42)}`,
      cid: TEST_CID,
      payloadHash: digest(43),
      sequence: 1n,
    };
    const tombstone: ProtocolEvent = {
      ...baseEvent(4n, 44),
      type: 'tombstoned',
      identityId,
      targetPostReference: postReference,
      targetObjectId: post.objectId,
      sequence: 2n,
    };
    const events = [...durableEvents(), post, tombstone];
    const dispositions = new Map(
      events.map((event) => [rawEventCoordinateKey(event), { state: 'accepted' as const }]),
    );
    const source = { get: vi.fn(() => Promise.reject(new Error('deleted content'))) };

    await projection.apply(initialized);
    await projection.apply(created);
    await projection.apply(post, {
      objectId: post.objectId,
      cid: post.cid as string,
      payloadHash: post.payloadHash,
      schemaVersion: 1,
      signingKeyId: `${identityId}#root`,
      authorIdentityId: identityId,
      createdAt: post.blockTime,
      type: 'post',
      content: {
        format: 'plain',
        body: 'Post whose accepted bytes were deleted',
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
      },
    });
    await projection.apply(tombstone);

    const incompleteDispositions = new Map(dispositions);
    incompleteDispositions.delete(rawEventCoordinateKey(tombstone));
    await expect(
      prepareIndexerRebuild(
        networkId,
        events,
        source,
        50_000,
        0n,
        new Map(),
        incompleteDispositions,
      ),
    ).rejects.toThrow('must exactly match supplied event coordinates');
    expect(source.get).not.toHaveBeenCalled();

    const prepared = await prepareIndexerRebuild(
      networkId,
      [...events].reverse(),
      source,
      50_000,
      0n,
      new Map(),
      dispositions,
    );

    expect(prepared.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: post,
          acceptedManifestSuppression: {
            reason: 'later-tombstone',
            suppressorTransactionSignature: tombstone.transactionSignature,
            suppressorLogIndex: tombstone.logIndex,
          },
        }),
      ]),
    );
    expect(prepared.ledgerSha256).toMatch(/^[0-9a-f]{64}$/u);

    await expect(
      validateAndMaybeApplyIndexerRebuild({
        networkId,
        events: [...events].reverse(),
        source,
        apply: true,
        target: projection,
        durableDispositions: dispositions,
      }),
    ).resolves.toMatchObject({ mode: 'applied', eventCount: 4 });
    expect(source.get).not.toHaveBeenCalled();
    await expect(projection.getPost(post.objectId)).resolves.toBeUndefined();
    await expect(projection.findPostObjectIdByReference(networkId, postReference)).resolves.toBe(
      post.objectId,
    );
    await expect(projection.manifestEventDisposition(post)).resolves.toEqual({
      state: 'accepted',
    });
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 2n,
    });
    await expect(projection.checkpoint(networkId)).resolves.toBe(4n);
  });

  it('atomically rebuilds an accepted deleted profile behind a later terminal pointer', async () => {
    const projection = new MemoryProjectionStore();
    const [initialized, created] = durableEvents();
    if (initialized === undefined || created === undefined) {
      throw new Error('Expected durable event fixtures.');
    }
    const oldProfile: ProtocolEvent = {
      ...baseEvent(3n, 45),
      type: 'profile-updated',
      identityId,
      objectId: `wetdroolobj:v1:profile:${digest(46)}`,
      cid: TEST_CID,
      payloadHash: digest(47),
      sequence: 1n,
      profileSchemaVersion: 2,
    };
    const terminalProfile: ProtocolEvent = {
      ...baseEvent(4n, 48),
      type: 'profile-updated',
      identityId,
      objectId: `wetdroolobj:v1:profile:${digest(49)}`,
      cid: TEST_CID,
      payloadHash: digest(50),
      sequence: 2n,
      profileSchemaVersion: 2,
    };
    const terminalFailureCode = 'manifest-invalid' as const;
    const events = [initialized, created, oldProfile, terminalProfile];
    const dispositions = new Map(
      events.map((event) => [
        rawEventCoordinateKey(event),
        event === terminalProfile
          ? ({ state: 'terminal' as const, failureCode: terminalFailureCode } as const)
          : ({ state: 'accepted' as const } as const),
      ]),
    );
    const source = { get: vi.fn(() => Promise.reject(new Error('deleted profile bytes'))) };

    await projection.apply(initialized);
    await projection.apply(created);
    await projection.apply(oldProfile, {
      objectId: oldProfile.objectId,
      cid: oldProfile.cid as string,
      payloadHash: oldProfile.payloadHash,
      schemaVersion: 2,
      signingKeyId: `${identityId}#root`,
      authorIdentityId: identityId,
      createdAt: oldProfile.blockTime,
      type: 'profile',
      content: {
        displayName: 'Profile whose bytes were deleted',
        bio: '',
        pronouns: [],
        chosenFamilyLabels: [],
        links: [],
      },
    });
    await projection.quarantineManifestEvent(terminalProfile, {
      eventBody: {},
      failureCode: terminalFailureCode,
      failureDetail: 'The later canonical profile pointer is invalid.',
    });

    await expect(
      validateAndMaybeApplyIndexerRebuild({
        networkId,
        events: [...events].reverse(),
        source,
        apply: true,
        target: projection,
        durableDispositions: dispositions,
      }),
    ).resolves.toMatchObject({
      mode: 'applied',
      eventCount: 4,
      ledgerSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(source.get).not.toHaveBeenCalled();
    await expect(projection.getProfile(identityId)).resolves.toBeUndefined();
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 2n,
    });
    await expect(projection.checkpoint(networkId)).resolves.toBe(4n);
    await expect(projection.manifestEventDisposition(oldProfile)).resolves.toEqual({
      state: 'accepted',
    });
    await expect(projection.manifestEventDisposition(terminalProfile)).resolves.toEqual({
      state: 'terminal',
      failureCode: terminalFailureCode,
    });
  });

  it('replays a durable pending manifest without content I/O or disposition drift', async () => {
    const pendingPost: ProtocolEvent = {
      ...baseEvent(3n, 13),
      type: 'post-published',
      identityId,
      objectId: `wetdroolobj:v1:post:${digest(14)}`,
      cid: TEST_CID,
      payloadHash: digest(15),
      sequence: 1n,
    };
    const events = [...durableEvents(), pendingPost];
    const deferral = {
      eventBody: { encodedData: 'durable-pending-fixture' },
      failureCode: 'manifest-unavailable' as const,
      failureDetail: 'Manifest bytes are not available yet.',
      nextAttemptAt: '2026-07-28T12:05:00.000Z',
    };
    const dispositions = new Map(
      events.map((event) => [
        rawEventCoordinateKey(event),
        event === pendingPost
          ? ({ state: 'pending' as const, deferral } as const)
          : ({ state: 'accepted' as const } as const),
      ]),
    );
    const source = { get: vi.fn(() => Promise.reject(new Error('must not be called'))) };

    await expect(
      prepareIndexerRebuild(networkId, events, source, 50_000, 0n, new Map(), dispositions),
    ).resolves.toMatchObject({
      eventCount: 3,
      items: expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({ type: 'post-published' }),
          pendingManifest: deferral,
        }),
      ]),
    });
    expect(source.get).not.toHaveBeenCalled();
  });

  it('refuses empty or cross-network rebuild sources', async () => {
    const source = new MemoryContentAddressedStorage();
    await expect(prepareIndexerRebuild(networkId, [], source)).rejects.toBeInstanceOf(
      IndexerRebuildError,
    );

    const otherNetworkId = `droolnet:v1:${publicKey(20)}:${programId}` as NetworkId;
    const firstEvent = durableEvents()[0];
    if (firstEvent === undefined) {
      throw new Error('Expected a durable event fixture.');
    }
    const crossNetworkEvent: ProtocolEvent = {
      ...firstEvent,
      networkId: otherNetworkId,
    };
    await expect(prepareIndexerRebuild(networkId, [crossNetworkEvent], source)).rejects.toThrow(
      'cannot cross network boundaries',
    );
    await expect(prepareIndexerRebuild(networkId, durableEvents(), source, 1)).rejects.toThrow(
      'exceeds the bounded limit of 1 event',
    );
    await expect(prepareIndexerRebuild(networkId, durableEvents(), source, 0)).rejects.toThrow(
      'Maximum rebuild events must be between 1 and 50000',
    );
  });

  it('rejects ambiguous or conflicting transaction order within one slot', async () => {
    const [first, second] = durableEvents();
    if (first === undefined || second === undefined) {
      throw new Error('Expected durable event fixtures.');
    }
    const firstWithoutIndex = { ...first };
    const secondWithoutIndex = { ...second };
    delete firstWithoutIndex.transactionIndex;
    delete secondWithoutIndex.transactionIndex;
    const ambiguous = [
      { ...firstWithoutIndex, slot: 7n },
      { ...secondWithoutIndex, slot: 7n },
    ] as const;

    await expect(
      prepareIndexerRebuild(networkId, ambiguous, new MemoryContentAddressedStorage()),
    ).rejects.toThrow('require authoritative transaction indexes');
    await expect(
      prepareIndexerRebuild(
        networkId,
        [
          { ...first, slot: 7n, transactionIndex: 4 },
          { ...second, slot: 7n, transactionIndex: 4 },
        ],
        new MemoryContentAddressedStorage(),
      ),
    ).rejects.toThrow('cannot share a transaction index');
  });

  it('rejects an unjustified accepted-manifest suppression before replacing memory state', async () => {
    const projection = new MemoryProjectionStore();
    const [initialized, created] = durableEvents();
    if (initialized === undefined || created === undefined) {
      throw new Error('Expected durable event fixtures.');
    }
    const postReference = publicKey(31);
    const post: ProtocolEvent = {
      ...baseEvent(3n, 30),
      type: 'post-published',
      identityId,
      postReference,
      objectId: `wetdroolobj:v1:post:${digest(32)}`,
      cid: TEST_CID,
      payloadHash: digest(33),
      sequence: 1n,
    };
    const tombstone: ProtocolEvent = {
      ...baseEvent(4n, 34),
      type: 'tombstoned',
      identityId,
      targetPostReference: postReference,
      targetObjectId: post.objectId,
      sequence: 2n,
    };
    await projection.apply(initialized);
    await projection.apply(created);
    await projection.apply(post, {
      objectId: post.objectId,
      cid: post.cid as string,
      payloadHash: post.payloadHash,
      schemaVersion: 1,
      signingKeyId: `${identityId}#root`,
      authorIdentityId: identityId,
      createdAt: post.blockTime,
      type: 'post',
      content: {
        format: 'plain',
        body: 'Accepted post deleted after its tombstone.',
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
      },
    });
    await projection.apply(tombstone);

    const replay = [
      { event: initialized },
      { event: created },
      {
        event: post,
        acceptedManifestSuppression: {
          reason: 'later-profile-pointer' as const,
          suppressorTransactionSignature: tombstone.transactionSignature,
          suppressorLogIndex: tombstone.logIndex,
        },
      },
      { event: tombstone },
    ] as const;
    await expect(projection.rebuildProjection(networkId, replay)).rejects.toMatchObject({
      code: 'event-conflict',
    });
    await expect(projection.getPost(post.objectId)).resolves.toMatchObject({
      tombstonedAt: tombstone.blockTime,
    });

    await expect(
      projection.rebuildProjection(networkId, [
        { event: initialized },
        { event: created },
        {
          event: post,
          acceptedManifestSuppression: {
            reason: 'later-tombstone',
            suppressorTransactionSignature: tombstone.transactionSignature,
            suppressorLogIndex: tombstone.logIndex,
          },
        },
        { event: tombstone },
      ]),
    ).resolves.toBeUndefined();
    await expect(projection.getPost(post.objectId)).resolves.toBeUndefined();
    await expect(projection.findPostObjectIdByReference(networkId, postReference)).resolves.toBe(
      post.objectId,
    );
    await expect(projection.manifestEventDisposition(post)).resolves.toEqual({
      state: 'accepted',
    });
  });

  it('cannot add, omit, duplicate, or rewrite the immutable raw source', async () => {
    const projection = new MemoryProjectionStore();
    const [initialized, created] = durableEvents();
    if (initialized === undefined || created === undefined) {
      throw new Error('Expected durable event fixtures.');
    }
    await projection.apply(initialized);
    await projection.apply(created);

    await expect(projection.rebuildProjection(networkId, [{ event: initialized }])).rejects.toThrow(
      'exactly match the immutable raw event source',
    );
    await expect(
      projection.rebuildProjection(networkId, [
        { event: initialized },
        { event: created },
        {
          event: {
            ...baseEvent(3n, 99),
            type: 'protocol-initialized',
            configAddress: publicKey(99),
          },
        },
      ]),
    ).rejects.toThrow('exactly match the immutable raw event source');
    await expect(
      projection.rebuildProjection(networkId, [
        { event: initialized },
        { event: initialized },
        { event: created },
      ]),
    ).rejects.toThrow('duplicate raw event coordinate');
    await expect(
      projection.rebuildProjection(networkId, [
        { event: { ...initialized, blockTime: '2026-07-28T14:59:59.000Z' } },
        { event: created },
      ]),
    ).rejects.toMatchObject({ code: 'event-conflict' });
    await expect(
      projection.rebuildProjection(networkId, [{ event: created }, { event: initialized }]),
    ).resolves.toBeUndefined();
  });
});

function durableEvents(): readonly ProtocolEvent[] {
  return [
    {
      ...baseEvent(1n, 6),
      type: 'protocol-initialized',
      configAddress: publicKey(7),
    },
    {
      ...baseEvent(2n, 8),
      type: 'identity-created',
      identityId,
      identityAddress,
      rootAuthority,
    },
  ];
}

function baseEvent(slot: bigint, signatureSeed: number) {
  return {
    networkId,
    programId,
    transactionSignature: transactionSignature(signatureSeed),
    transactionIndex: 0,
    slot,
    logIndex: 0,
    blockTime: `2026-07-28T12:00:0${slot.toString()}.000Z`,
    finalized: true as const,
  };
}

function rawRow(event: ProtocolEvent) {
  return {
    network_id: event.networkId,
    transaction_signature: event.transactionSignature,
    transaction_index: event.transactionIndex ?? null,
    log_index: event.logIndex,
    slot: event.slot.toString(),
    block_time: new Date(event.blockTime),
    event_type: event.type,
    event_body: JSON.parse(
      JSON.stringify(event, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ) as unknown,
  };
}

function publicKey(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 32 }, () => seed));
}

function transactionSignature(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 64 }, () => seed));
}

function digest(seed: number): string {
  return encodeMultibaseBase64Url(Uint8Array.from({ length: 32 }, () => seed));
}
