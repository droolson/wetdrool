import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import {
  buildProfilePayload,
  buildPostPayload,
  canonicalizeEnvelope,
  canonicalizePayload,
  canonicalizeProofDescriptor,
  createPayloadBuilderIdentity,
  decodeMultibaseBase64Url,
  digestSha256Multibase,
  encodeMultibaseBase64Url,
  legacyProfilePayloadSchema,
  SIGNATURE_DOMAIN,
  signedEnvelopeSchema,
  signPayload,
  type NetworkId,
  type PostContent,
  type ProfileContent,
  type SignedEnvelope,
} from '@wokesocial/protocol';
import { MemoryContentAddressedStorage, type StorageReceipt } from '@wokesocial/storage';

import {
  decodeAnchorEventLog,
  extractProgramDataLogs,
  FailoverSolanaRpc,
  ManifestVerifier,
  MemoryProjectionStore,
  OpenIndexer,
  ProjectionRootKeyAuthorizer,
  readIndexerConfig,
  SOCIAL_PROTOCOL_EVENT_LAYOUT,
  SolanaEventMaterializer,
  SolanaSyncWorker,
  type FinalizedSignature,
  type FinalizedSolanaRpc,
  type FinalizedTransaction,
  type DeadLetterInput,
  type ManifestSource,
  type SolanaRpcEndpoint,
  type SolanaSyncResult,
} from '../src/index.js';
import { TEST_CID } from './cid-fixtures.js';

const programId = SOCIAL_PROTOCOL_EVENT_LAYOUT.programId;
const genesisHash = publicKey(7);
const networkId = `wokenet:v1:${genesisHash}:${programId}` as NetworkId;
const configAddress = publicKey(6);
const identityAddress = publicKey(9);
const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const rootAuthority = bs58.encode(ed25519.getPublicKey(privateKey));
const identityId = `wokesocialid:v1:${networkId}:${identityAddress}`;
const identity = createPayloadBuilderIdentity(
  networkId,
  identityId,
  ed25519.getPublicKey(privateKey),
  'root',
);
const identitySignature = transactionSignature(1);
const postSignature = transactionSignature(2);

describe('Anchor event decoder', () => {
  it('decodes the checked-in IDL layout and rejects trailing bytes', () => {
    const encoded = identityEventData(10n);
    expect(decodeAnchorEventLog(encoded)).toEqual({
      kind: 'identity-created',
      eventVersion: 1,
      config: configAddress,
      identity: identityAddress,
      rootAuthority,
      identityNonce: Uint8Array.from({ length: 16 }, (_, index) => index),
      createdAtSlot: 10n,
    });

    const withTrailingByte = Buffer.concat([
      Buffer.from(encoded, 'base64'),
      Buffer.from([255]),
    ]).toString('base64');
    expect(() => decodeAnchorEventLog(withTrailingByte)).toThrow('trailing bytes');
  });

  it('decodes the appended profile schema commitment while retaining legacy prefix replay', () => {
    const fields = [
      u16(1),
      pubkey(configAddress),
      pubkey(identityAddress),
      pubkey(rootAuthority),
      u64(1n),
      new Uint8Array(32),
      Uint8Array.from({ length: 32 }, () => 7),
      borshString(`ipfs://${TEST_CID}`),
      u64(11n),
    ] as const;
    const current = eventData(
      SOCIAL_PROTOCOL_EVENT_LAYOUT.events.ProfileReferenceUpdated,
      ...fields,
      u16(2),
    );
    const legacy = eventData(
      SOCIAL_PROTOCOL_EVENT_LAYOUT.events.ProfileReferenceUpdated,
      ...fields,
    );

    expect(decodeAnchorEventLog(current)).toMatchObject({
      kind: 'profile-updated',
      profileSchemaVersion: 2,
      updatedAtSlot: 11n,
    });
    expect(decodeAnchorEventLog(legacy)).toMatchObject({
      kind: 'profile-updated',
      updatedAtSlot: 11n,
    });
    expect(decodeAnchorEventLog(legacy)).not.toHaveProperty('profileSchemaVersion');
    const malformed = Buffer.concat([Buffer.from(legacy, 'base64'), Buffer.from([2])]).toString(
      'base64',
    );
    expect(() => decodeAnchorEventLog(malformed)).toThrow(
      'malformed trailing schema-version commitment',
    );
  });

  it('decodes and strictly materializes identity deactivation', async () => {
    const decoded = decodeAnchorEventLog(identityDeactivatedEventData(11n, 4n));
    expect(decoded).toEqual({
      kind: 'identity-deactivated',
      eventVersion: 1,
      config: configAddress,
      identity: identityAddress,
      rootAuthority,
      identitySequence: 4n,
      deactivatedAtSlot: 11n,
    });

    const materializer = new SolanaEventMaterializer(
      new MemoryContentAddressedStorage(),
      new MemoryProjectionStore(),
    );
    await expect(
      materializer.materialize(decoded, {
        networkId,
        programId,
        transactionSignature: transactionSignature(3),
        slot: 11n,
        logIndex: 1,
        blockTime: 1_784_899_201,
      }),
    ).resolves.toEqual({
      networkId,
      programId,
      transactionSignature: transactionSignature(3),
      slot: 11n,
      logIndex: 1,
      blockTime: '2026-07-24T13:20:01.000Z',
      finalized: true,
      type: 'identity-deactivated',
      configAddress,
      identityId,
      identityAddress,
      rootAuthority,
      identitySequence: 4n,
    });
  });

  it('accepts event data only while the configured program is executing', () => {
    const encoded = identityEventData(10n);
    const attacker = publicKey(44);
    expect(
      extractProgramDataLogs(
        [
          `Program ${attacker} invoke [1]`,
          `Program data: ${encoded}`,
          `Program ${programId} invoke [2]`,
          `Program data: ${encoded}`,
          `Program ${programId} success`,
          `Program ${attacker} success`,
        ],
        programId,
      ),
    ).toEqual([{ logIndex: 3, encodedData: encoded }]);
  });
});

describe('Solana RPC failover', () => {
  it('quarantines the wrong genesis and fails over between validated providers', async () => {
    const wrongNetwork = new FakeEndpoint('https://wrong.example', {
      genesisHash: publicKey(55),
      finalizedSlot: 1n,
    });
    const unavailable = new FakeEndpoint('https://unavailable.example', {
      genesisHash,
      finalizedSlotError: new Error('provider unavailable'),
    });
    const healthy = new FakeEndpoint('https://healthy.example', {
      genesisHash,
      finalizedSlot: 99n,
    });
    const rpc = new FailoverSolanaRpc([wrongNetwork, unavailable, healthy], genesisHash, programId);

    await expect(rpc.finalizedSlot()).resolves.toBe(99n);
    expect(wrongNetwork.finalizedSlotCalls).toBe(0);
    expect(unavailable.finalizedSlotCalls).toBe(1);
    expect(healthy.finalizedSlotCalls).toBe(1);
  });
});

describe('Solana sync configuration', () => {
  it('stays read-only with neither identifier and rejects a partial network identity', () => {
    expect(readIndexerConfig({}).sync).toBeUndefined();
    expect(() => readIndexerConfig({ NEXT_PUBLIC_PROGRAM_ID: programId })).toThrow(
      /must be configured together/u,
    );
  });

  it('enables only a matching finalized network configuration', () => {
    expect(
      readIndexerConfig({
        INDEXER_NETWORK_ID: networkId,
        NEXT_PUBLIC_PROGRAM_ID: programId,
        WOKENET_COMMITMENT: 'finalized',
      }).sync,
    ).toMatchObject({
      networkId,
      programId,
      deploymentSlot: 0n,
      batchSize: 100,
    });

    expect(() =>
      readIndexerConfig({
        INDEXER_NETWORK_ID: `wokenet:v1:${genesisHash}:${publicKey(88)}`,
        NEXT_PUBLIC_PROGRAM_ID: programId,
      }),
    ).toThrow('network program ID must match');
  });
});

describe('finalized Solana synchronization', () => {
  it('reports each successful poll for runtime freshness tracking', async () => {
    const storage = new MemoryContentAddressedStorage();
    const projection = new MemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection)),
    );
    const controller = new AbortController();
    const results: SolanaSyncResult[] = [];
    const worker = workerFor({
      rpc: new MockFinalizedRpc(10n, [], []),
      projection,
      indexer,
      source: storage,
      sleep: () => Promise.resolve(),
      onPollSucceeded: (result) => {
        results.push(result);
        controller.abort();
      },
    });

    await expect(worker.run(controller.signal)).resolves.toBeUndefined();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      finalizedTip: 10n,
      checkpointAdvanced: true,
    });
  });

  it('replays in deterministic transaction/log order and resumes idempotently', async () => {
    const storage = new MemoryContentAddressedStorage();
    const published = await storePost(storage);
    const rpc = new MockFinalizedRpc(
      11n,
      [signatureInfo(postSignature, 11n, 1), signatureInfo(identitySignature, 10n, 0)],
      [
        transaction(identitySignature, 10n, identityEventData(10n), 1_784_899_200),
        transaction(
          postSignature,
          11n,
          postEventData(11n, published.receipt, published.envelope),
          1_784_899_201,
        ),
      ],
    );
    const projection = new RecordingMemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection)),
    );
    const worker = workerFor({
      rpc,
      projection,
      indexer,
      source: storage,
    });

    await expect(worker.runOnce()).resolves.toMatchObject({
      fromSlot: 10n,
      finalizedTip: 11n,
      signatures: 2,
      transactions: 2,
      decodedEvents: 2,
      appliedEvents: 2,
      duplicateEvents: 0,
      deadLetters: 0,
      checkpointAdvanced: true,
    });
    await expect(projection.checkpoint(networkId)).resolves.toBe(11n);
    await expect(
      projection.getFeed({ networkId, mode: 'chronological', limit: 10 }),
    ).resolves.toHaveLength(1);

    await storage.delete(published.receipt.cid);
    await expect(worker.runOnce()).resolves.toMatchObject({
      fromSlot: 11n,
      signatures: 1,
      decodedEvents: 1,
      appliedEvents: 0,
      duplicateEvents: 1,
      deadLetters: 0,
      checkpointAdvanced: true,
    });
    expect(rpc.requestedCommitment).toBe('finalized');
  });

  it('refuses an RPC response that is not finalized', async () => {
    const storage = new MemoryContentAddressedStorage();
    const projection = new MemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection)),
    );
    const rpc = new MockFinalizedRpc(
      10n,
      [
        {
          ...signatureInfo(identitySignature, 10n, 0),
          confirmationStatus: 'confirmed',
        },
      ],
      [transaction(identitySignature, 10n, identityEventData(10n), 1_784_899_200)],
    );

    await expect(
      workerFor({ rpc, projection, indexer, source: storage }).runOnce(),
    ).rejects.toThrow('non-finalized signature');
    await expect(projection.checkpoint(networkId)).resolves.toBeUndefined();
  });

  it('resolves an Anchor tombstone PDA to the verified post object', async () => {
    const storage = new MemoryContentAddressedStorage();
    const published = await storePost(storage);
    const tombstoneSignature = transactionSignature(4);
    const rpc = new MockFinalizedRpc(
      12n,
      [
        signatureInfo(tombstoneSignature, 12n, 2),
        signatureInfo(postSignature, 11n, 1),
        signatureInfo(identitySignature, 10n, 0),
      ],
      [
        transaction(identitySignature, 10n, identityEventData(10n), 1_784_899_200),
        transaction(
          postSignature,
          11n,
          postEventData(11n, published.receipt, published.envelope),
          1_784_899_201,
        ),
        transaction(tombstoneSignature, 12n, tombstoneEventData(12n), 1_784_899_202),
      ],
    );
    const projection = new MemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection)),
    );

    await expect(
      workerFor({ rpc, projection, indexer, source: storage }).runOnce(),
    ).resolves.toMatchObject({
      appliedEvents: 3,
      deadLetters: 0,
      checkpointAdvanced: true,
    });
    await expect(
      projection.getFeed({ networkId, mode: 'chronological', limit: 10 }),
    ).resolves.toEqual([]);
    expect(
      projection
        .events(networkId)
        .some(
          (event) => event.type === 'tombstoned' && event.targetPostReference === publicKey(12),
        ),
    ).toBe(true);
  });

  it('dead-letters a recognized but malformed Anchor event', async () => {
    const storage = new MemoryContentAddressedStorage();
    const projection = new RecordingMemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection)),
    );
    const malformed = Buffer.concat([
      Buffer.from(SOCIAL_PROTOCOL_EVENT_LAYOUT.events.IdentityCreated),
      Buffer.from(u16(1)),
    ]).toString('base64');
    const rpc = new MockFinalizedRpc(
      10n,
      [signatureInfo(identitySignature, 10n, 0)],
      [transaction(identitySignature, 10n, malformed, 1_784_899_200)],
    );

    await expect(
      workerFor({ rpc, projection, indexer, source: storage }).runOnce(),
    ).resolves.toMatchObject({
      deadLetters: 1,
      checkpointAdvanced: false,
    });
    expect(projection.recordedDeadLetters).toMatchObject([
      {
        transactionSignature: identitySignature,
        logIndex: 1,
        failureCode: 'malformed-anchor-event',
      },
    ]);
  });

  it('dead-letters an unsupported program event and never advances past it', async () => {
    const storage = new MemoryContentAddressedStorage();
    const projection = new RecordingMemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection)),
    );
    const unsupported = eventData([1, 2, 3, 4, 5, 6, 7, 8], u16(1));
    const rpc = new MockFinalizedRpc(
      10n,
      [signatureInfo(identitySignature, 10n, 0)],
      [transaction(identitySignature, 10n, unsupported, 1_784_899_200)],
    );

    await expect(
      workerFor({ rpc, projection, indexer, source: storage }).runOnce(),
    ).resolves.toMatchObject({
      decodedEvents: 0,
      deadLetters: 1,
      checkpointAdvanced: false,
    });
    await expect(projection.checkpoint(networkId)).resolves.toBeUndefined();
    expect(projection.recordedDeadLetters).toMatchObject([
      {
        transactionSignature: identitySignature,
        logIndex: 1,
        failureCode: 'unsupported-anchor-event',
      },
    ]);
  });

  it('hydrates a due manifest after the finalized checkpoint advances beyond its original log', async () => {
    const storage = new MemoryContentAddressedStorage();
    const published = await storePost(storage);
    const source = new ToggleManifestSource(storage);
    source.available = false;
    const rpc = new MockFinalizedRpc(
      11n,
      [signatureInfo(postSignature, 11n, 1), signatureInfo(identitySignature, 10n, 0)],
      [
        transaction(identitySignature, 10n, identityEventData(10n), 1_784_899_200),
        transaction(
          postSignature,
          11n,
          postEventData(11n, published.receipt, published.envelope),
          1_784_899_201,
        ),
      ],
    );
    const projection = new RecordingMemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(source, new ProjectionRootKeyAuthorizer(projection)),
    );
    let now = Date.parse('2026-07-28T12:00:00.000Z');
    const retrySleeps: number[] = [];
    const worker = workerFor({
      rpc,
      projection,
      indexer,
      source,
      now: () => now,
      sleep: (milliseconds) => {
        retrySleeps.push(milliseconds);
        return Promise.resolve();
      },
    });

    await expect(worker.runOnce()).resolves.toMatchObject({
      appliedEvents: 1,
      deferredManifestEvents: 1,
      deadLetters: 1,
      checkpointAdvanced: true,
    });
    expect(retrySleeps).toContain(5);
    await expect(projection.checkpoint(networkId)).resolves.toBe(11n);
    await expect(projection.deadLetter(networkId, postSignature, 1)).resolves.toEqual({
      attempts: 1,
      nextAttemptAt: '2026-07-28T12:00:00.005Z',
    });
    const deferredEvent = projection
      .events(networkId)
      .find((event) => event.type === 'post-published');
    if (deferredEvent === undefined) {
      throw new Error('Expected the unavailable post to be retained in the raw event ledger.');
    }
    await expect(projection.manifestEventDisposition(deferredEvent)).resolves.toEqual({
      state: 'pending',
    });

    const caughtUpWorker = workerFor({
      rpc: new MockFinalizedRpc(12n, [], []),
      projection,
      indexer,
      source,
      now: () => now,
      sleep: (milliseconds) => {
        retrySleeps.push(milliseconds);
        return Promise.resolve();
      },
    });

    await expect(caughtUpWorker.runOnce()).resolves.toMatchObject({
      deadLetters: 0,
      checkpointAdvanced: true,
    });
    await expect(projection.checkpoint(networkId)).resolves.toBe(12n);
    await expect(projection.deadLetter(networkId, postSignature, 1)).resolves.toMatchObject({
      attempts: 1,
    });

    source.available = true;
    now += 6;
    await expect(caughtUpWorker.runOnce()).resolves.toMatchObject({
      appliedEvents: 0,
      hydratedManifestEvents: 1,
      deadLetters: 0,
      checkpointAdvanced: true,
    });
    await expect(projection.deadLetter(networkId, postSignature, 1)).resolves.toBeUndefined();
    await expect(projection.checkpoint(networkId)).resolves.toBe(12n);
    await expect(
      projection.getFeed({ networkId, mode: 'chronological', limit: 10 }),
    ).resolves.toHaveLength(1);
  });

  it('terminally quarantines an invalid profile and continues the same identity and transaction', async () => {
    const storage = new MemoryContentAddressedStorage();
    const validProfile = await storeProfile(storage);
    const legacyProfile = await storeLegacyProfile(storage);
    const published = await storePost(storage);
    const source = new CountingManifestSource(storage);
    const profileSignature = transactionSignature(5);
    const combinedSignature = transactionSignature(6);
    const rpc = new MockFinalizedRpc(
      12n,
      [
        signatureInfo(combinedSignature, 12n, 2),
        signatureInfo(profileSignature, 11n, 1),
        signatureInfo(identitySignature, 10n, 0),
      ],
      [
        transaction(identitySignature, 10n, identityEventData(10n), 1_784_899_200),
        transaction(
          profileSignature,
          11n,
          profileEventData(
            11n,
            validProfile.receipt,
            validProfile.envelope,
            1n,
            new Uint8Array(32),
          ),
          1_784_899_201,
        ),
        transactionWithEvents(
          combinedSignature,
          12n,
          [
            profileEventData(
              12n,
              legacyProfile.receipt,
              legacyProfile.envelope,
              2n,
              decodeMultibaseBase64Url(validProfile.envelope.proof.payloadHash, 32),
            ),
            postEventData(12n, published.receipt, published.envelope, 3n),
          ],
          1_784_899_202,
        ),
      ],
    );
    const projection = new MemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(source, new ProjectionRootKeyAuthorizer(projection), {
        profileSchemaV2ActivationSlot: 12n,
      }),
    );
    const worker = workerFor({ rpc, projection, indexer, source });

    await expect(worker.runOnce()).resolves.toMatchObject({
      appliedEvents: 3,
      duplicateEvents: 0,
      quarantinedEvents: 1,
      deadLetters: 1,
      checkpointAdvanced: true,
    });
    await expect(projection.checkpoint(networkId)).resolves.toBe(12n);
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 3n,
    });
    await expect(projection.getProfile(identityId)).resolves.toBeUndefined();
    await expect(
      projection.getFeed({ networkId, mode: 'chronological', limit: 10 }),
    ).resolves.toHaveLength(1);
    await expect(projection.deadLetter(networkId, combinedSignature, 1)).resolves.toEqual({
      attempts: 1,
      terminalFailureCode: 'schema-version',
    });
    expect(projection.events(networkId).map(({ type }) => type)).toEqual([
      'identity-created',
      'profile-updated',
      'profile-updated',
      'post-published',
    ]);
    const legacyReads = source.callsFor(legacyProfile.receipt.cid);
    expect(legacyReads).toBe(1);

    await expect(worker.runOnce()).resolves.toMatchObject({
      appliedEvents: 0,
      duplicateEvents: 1,
      quarantinedEvents: 0,
      deadLetters: 0,
      checkpointAdvanced: true,
    });
    expect(source.callsFor(legacyProfile.receipt.cid)).toBe(legacyReads);
    await expect(projection.deadLetter(networkId, combinedSignature, 1)).resolves.toEqual({
      attempts: 1,
      terminalFailureCode: 'schema-version',
    });
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 3n,
    });
  });

  it('quarantines non-canonical content without blocking later finalized mutations', async () => {
    const storage = new MemoryContentAddressedStorage();
    const profileReference = await storeProfile(storage);
    const invalidReceipt = await storage.put(Uint8Array.from([0, 1, 2, 3]), {
      permanence: 'deletion-compatible',
    });
    const published = await storePost(storage);
    const invalidSignature = transactionSignature(7);
    const laterSignature = transactionSignature(8);
    const rpc = new MockFinalizedRpc(
      12n,
      [
        signatureInfo(laterSignature, 12n, 2),
        signatureInfo(invalidSignature, 11n, 1),
        signatureInfo(identitySignature, 10n, 0),
      ],
      [
        transaction(identitySignature, 10n, identityEventData(10n), 1_784_899_200),
        transaction(
          invalidSignature,
          11n,
          profileEventData(11n, invalidReceipt, profileReference.envelope, 1n, new Uint8Array(32)),
          1_784_899_201,
        ),
        transaction(
          laterSignature,
          12n,
          postEventData(12n, published.receipt, published.envelope, 2n),
          1_784_899_202,
        ),
      ],
    );
    const projection = new MemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection)),
    );

    await expect(
      workerFor({ rpc, projection, indexer, source: storage }).runOnce(),
    ).resolves.toMatchObject({
      appliedEvents: 2,
      quarantinedEvents: 1,
      deadLetters: 1,
      checkpointAdvanced: true,
    });
    await expect(projection.deadLetter(networkId, invalidSignature, 1)).resolves.toEqual({
      attempts: 1,
      terminalFailureCode: 'manifest-invalid',
    });
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 2n,
    });
    await expect(
      projection.getFeed({ networkId, mode: 'chronological', limit: 10 }),
    ).resolves.toHaveLength(1);
  });

  it('terminally quarantines an on-chain URI that cannot resolve to a content CID', async () => {
    const storage = new MemoryContentAddressedStorage();
    const profile = await storeProfile(storage);
    const source = new CountingManifestSource(storage);
    const invalidSignature = transactionSignature(9);
    const rpc = new MockFinalizedRpc(
      11n,
      [signatureInfo(invalidSignature, 11n, 1), signatureInfo(identitySignature, 10n, 0)],
      [
        transaction(identitySignature, 10n, identityEventData(10n), 1_784_899_200),
        transaction(
          invalidSignature,
          11n,
          profileEventData(
            11n,
            profile.receipt,
            profile.envelope,
            1n,
            new Uint8Array(32),
            'ar://opaque-profile-reference',
          ),
          1_784_899_201,
        ),
      ],
    );
    const projection = new MemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(source, new ProjectionRootKeyAuthorizer(projection)),
    );

    await expect(workerFor({ rpc, projection, indexer, source }).runOnce()).resolves.toMatchObject({
      appliedEvents: 1,
      quarantinedEvents: 1,
      checkpointAdvanced: true,
    });
    await expect(projection.deadLetter(networkId, invalidSignature, 1)).resolves.toEqual({
      attempts: 1,
      terminalFailureCode: 'manifest-uri',
    });
    expect(source.callsFor(profile.receipt.cid)).toBe(0);
    await expect(projection.getIdentity(identityId)).resolves.toMatchObject({
      identitySequence: 1n,
    });
  });

  it('fails closed when an RPC omits same-slot transaction order', async () => {
    const storage = new MemoryContentAddressedStorage();
    const projection = new MemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection)),
    );
    const unordered: readonly FinalizedSignature[] = [
      {
        signature: identitySignature,
        slot: 10n,
        blockTime: 1_784_899_200,
        failed: false,
        confirmationStatus: 'finalized',
      },
      {
        signature: postSignature,
        slot: 10n,
        blockTime: 1_784_899_200,
        failed: false,
        confirmationStatus: 'finalized',
      },
    ];
    const worker = workerFor({
      rpc: new MockFinalizedRpc(10n, unordered, []),
      projection,
      indexer,
      source: storage,
    });

    await expect(worker.runOnce()).rejects.toThrow('omitted the authoritative transaction index');
    await expect(projection.checkpoint(networkId)).resolves.toBeUndefined();
  });
});

interface WorkerFixture {
  readonly rpc: FinalizedSolanaRpc;
  readonly projection: MemoryProjectionStore;
  readonly indexer: OpenIndexer;
  readonly source: ManifestSource;
  readonly now?: () => number;
  readonly onPollSucceeded?: (result: SolanaSyncResult) => void;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

function workerFor(fixture: WorkerFixture): SolanaSyncWorker {
  return new SolanaSyncWorker({
    rpc: fixture.rpc,
    projection: fixture.projection,
    indexer: fixture.indexer,
    materializer: new SolanaEventMaterializer(fixture.source, fixture.projection),
    networkId,
    programId,
    deploymentSlot: 10n,
    batchSize: 2,
    pollIntervalMilliseconds: 100,
    retryAttempts: 2,
    retryBaseMilliseconds: 5,
    retryMaximumMilliseconds: 20,
    ...(fixture.now === undefined ? {} : { now: fixture.now }),
    ...(fixture.onPollSucceeded === undefined ? {} : { onPollSucceeded: fixture.onPollSucceeded }),
    ...(fixture.sleep === undefined ? {} : { sleep: fixture.sleep }),
  });
}

class MockFinalizedRpc implements FinalizedSolanaRpc {
  requestedCommitment: string | undefined;
  readonly #transactions: ReadonlyMap<string, FinalizedTransaction>;

  constructor(
    private readonly tip: bigint,
    private readonly signatures: readonly FinalizedSignature[],
    transactions: readonly FinalizedTransaction[],
  ) {
    this.#transactions = new Map(
      transactions.map((transactionValue) => [transactionValue.signature, transactionValue]),
    );
  }

  initialize(): Promise<void> {
    this.requestedCommitment = 'finalized';
    return Promise.resolve();
  }

  finalizedSlot(): Promise<bigint> {
    return Promise.resolve(this.tip);
  }

  signaturesForProgram(input: {
    readonly programId: string;
    readonly before?: string;
    readonly limit: number;
  }): Promise<readonly FinalizedSignature[]> {
    expect(input.programId).toBe(programId);
    const start =
      input.before === undefined
        ? 0
        : this.signatures.findIndex((item) => item.signature === input.before) + 1;
    return Promise.resolve(this.signatures.slice(start, start + input.limit));
  }

  transaction(transactionSignatureValue: string): Promise<FinalizedTransaction | null> {
    return Promise.resolve(this.#transactions.get(transactionSignatureValue) ?? null);
  }
}

class FakeEndpoint implements SolanaRpcEndpoint {
  finalizedSlotCalls = 0;

  constructor(
    readonly url: string,
    private readonly values: {
      readonly genesisHash: string;
      readonly finalizedSlot?: bigint;
      readonly finalizedSlotError?: Error;
    },
  ) {}

  genesisHash(): Promise<string> {
    return Promise.resolve(this.values.genesisHash);
  }

  programIsExecutable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  finalizedSlot(): Promise<bigint> {
    this.finalizedSlotCalls += 1;
    if (this.values.finalizedSlotError !== undefined) {
      return Promise.reject(this.values.finalizedSlotError);
    }
    return Promise.resolve(this.values.finalizedSlot ?? 0n);
  }

  signaturesForProgram(): Promise<readonly FinalizedSignature[]> {
    return Promise.resolve([]);
  }

  transaction(): Promise<FinalizedTransaction | null> {
    return Promise.resolve(null);
  }
}

class ToggleManifestSource implements ManifestSource {
  available = true;

  constructor(private readonly storage: MemoryContentAddressedStorage) {}

  get(cid: string): Promise<Uint8Array> {
    return this.available
      ? this.storage.get(cid)
      : Promise.reject(new Error('simulated content provider outage'));
  }
}

class CountingManifestSource implements ManifestSource {
  readonly #calls = new Map<string, number>();

  constructor(private readonly storage: MemoryContentAddressedStorage) {}

  async get(cid: string): Promise<Uint8Array> {
    this.#calls.set(cid, (this.#calls.get(cid) ?? 0) + 1);
    return this.storage.get(cid);
  }

  callsFor(cid: string): number {
    return this.#calls.get(cid) ?? 0;
  }
}

class RecordingMemoryProjectionStore extends MemoryProjectionStore {
  readonly recordedDeadLetters: DeadLetterInput[] = [];

  override recordDeadLetter(input: DeadLetterInput) {
    this.recordedDeadLetters.push(input);
    return super.recordDeadLetter(input);
  }
}

function signatureInfo(
  signatureValue: string,
  slot: bigint,
  transactionIndex: number,
): FinalizedSignature {
  return {
    signature: signatureValue,
    slot,
    blockTime: 1_784_899_200 + Number(slot),
    failed: false,
    confirmationStatus: 'finalized',
    transactionIndex,
  };
}

function transaction(
  signatureValue: string,
  slot: bigint,
  encodedEvent: string,
  blockTime: number,
): FinalizedTransaction {
  return {
    signature: signatureValue,
    slot,
    blockTime,
    failed: false,
    logMessages: [
      `Program ${programId} invoke [1]`,
      `Program data: ${encodedEvent}`,
      `Program ${programId} success`,
    ],
  };
}

function transactionWithEvents(
  signatureValue: string,
  slot: bigint,
  encodedEvents: readonly string[],
  blockTime: number,
): FinalizedTransaction {
  return {
    signature: signatureValue,
    slot,
    blockTime,
    failed: false,
    logMessages: encodedEvents.flatMap((encodedEvent) => [
      `Program ${programId} invoke [1]`,
      `Program data: ${encodedEvent}`,
      `Program ${programId} success`,
    ]),
  };
}

async function storeProfile(storage: MemoryContentAddressedStorage): Promise<{
  readonly envelope: SignedEnvelope;
  readonly receipt: StorageReceipt;
}> {
  const content: ProfileContent = {
    displayName: 'Valid profile before the poison event',
    bio: '',
    pronouns: [],
    chosenFamilyLabels: [],
    links: [],
  };
  const envelope = signPayload(
    buildProfilePayload(identity, content, {
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      nonce: Uint8Array.from({ length: 16 }, (_, index) => 48 + index),
    }),
    privateKey,
  );
  const receipt = await storage.put(canonicalizeEnvelope(envelope), {
    permanence: 'deletion-compatible',
  });
  return { envelope, receipt };
}

async function storeLegacyProfile(storage: MemoryContentAddressedStorage): Promise<{
  readonly envelope: SignedEnvelope;
  readonly receipt: StorageReceipt;
}> {
  const payload = legacyProfilePayloadSchema.parse({
    protocol: 'wokesocial',
    protocolVersion: '1.0',
    schemaVersion: 1,
    network: networkId,
    author: identityId,
    signingKey: identity.signingKey,
    createdAt: '2026-07-28T12:00:01.000Z',
    nonce: encodeMultibaseBase64Url(Uint8Array.from({ length: 16 }, (_, index) => 64 + index)),
    critical: [],
    extensions: {},
    type: 'profile',
    content: {
      displayName: 'Legacy plaintext profile',
      bio: '',
      pronouns: [{ value: 'private-value', visibility: 'private' }],
      genderVisibility: 'private',
      chosenFamilyLabels: [],
      links: [],
    },
  });
  const payloadHash = digestSha256Multibase(canonicalizePayload(payload));
  const envelope = signedEnvelopeSchema.parse({
    payload,
    proof: {
      algorithm: 'Ed25519',
      keyId: payload.signingKey,
      payloadHash,
      signature: encodeMultibaseBase64Url(
        ed25519.sign(
          canonicalizeProofDescriptor({
            domain: SIGNATURE_DOMAIN,
            version: 1,
            algorithm: 'Ed25519',
            keyId: payload.signingKey,
            network: payload.network,
            objectType: payload.type,
            payloadHash,
          }),
          privateKey,
        ),
      ),
    },
  });
  const receipt = await storage.put(canonicalizeEnvelope(envelope), {
    permanence: 'deletion-compatible',
  });
  return { envelope, receipt };
}

async function storePost(storage: MemoryContentAddressedStorage): Promise<{
  readonly envelope: SignedEnvelope;
  readonly receipt: StorageReceipt;
}> {
  const content: PostContent = {
    format: 'plain',
    body: 'Indexed from a finalized Anchor event.',
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
  const payload = buildPostPayload(identity, content, {
    createdAt: new Date('2026-07-28T12:00:01.000Z'),
    nonce: Uint8Array.from({ length: 16 }, (_, index) => 16 + index),
  });
  const envelope = signPayload(payload, privateKey);
  const receipt = await storage.put(canonicalizeEnvelope(envelope), {
    permanence: 'deletion-compatible',
  });
  return { envelope, receipt };
}

function identityEventData(slot: bigint): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.IdentityCreated,
    u16(1),
    pubkey(configAddress),
    pubkey(identityAddress),
    pubkey(rootAuthority),
    Uint8Array.from({ length: 16 }, (_, index) => index),
    u64(slot),
  );
}

function identityDeactivatedEventData(slot: bigint, sequence: bigint): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.IdentityDeactivated,
    u16(1),
    pubkey(configAddress),
    pubkey(identityAddress),
    pubkey(rootAuthority),
    u64(sequence),
    u64(slot),
  );
}

function profileEventData(
  slot: bigint,
  receipt: StorageReceipt,
  envelope: SignedEnvelope,
  sequence: bigint,
  previousManifestHash: Uint8Array,
  manifestUri = `ipfs://${receipt.cid}`,
  profileSchemaVersion: number | undefined = 2,
): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.ProfileReferenceUpdated,
    u16(1),
    pubkey(configAddress),
    pubkey(identityAddress),
    pubkey(rootAuthority),
    u64(sequence),
    previousManifestHash,
    decodeMultibaseBase64Url(envelope.proof.payloadHash, 32),
    borshString(manifestUri),
    u64(slot),
    ...(profileSchemaVersion === undefined ? [] : [u16(profileSchemaVersion)]),
  );
}

function postEventData(
  slot: bigint,
  receipt: StorageReceipt,
  envelope: SignedEnvelope,
  sequence = 1n,
): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.PostReferencePublished,
    u16(1),
    pubkey(configAddress),
    pubkey(publicKey(12)),
    pubkey(identityAddress),
    pubkey(rootAuthority),
    Uint8Array.from({ length: 16 }, (_, index) => 16 + index),
    u64(sequence),
    decodeMultibaseBase64Url(envelope.proof.payloadHash, 32),
    borshString(`ipfs://${receipt.cid}`),
    u64(slot),
  );
}

function tombstoneEventData(slot: bigint): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.PostTombstoned,
    u16(1),
    pubkey(configAddress),
    pubkey(publicKey(13)),
    pubkey(publicKey(12)),
    pubkey(identityAddress),
    u64(2n),
    Uint8Array.from({ length: 32 }, () => 1),
    Uint8Array.of(0),
    u64(slot),
  );
}

function eventData(discriminator: readonly number[], ...fields: readonly Uint8Array[]): string {
  return Buffer.concat([
    Buffer.from(discriminator),
    ...fields.map((field) => Buffer.from(field)),
  ]).toString('base64');
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
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

function publicKey(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 32 }, () => seed));
}

function transactionSignature(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 64 }, () => seed));
}
