import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import {
  buildPostPayload,
  canonicalizeEnvelope,
  createPayloadBuilderIdentity,
  decodeMultibaseBase64Url,
  signPayload,
  type NetworkId,
  type PostContent,
  type SignedEnvelope,
} from '@socially-woke/protocol';
import { MemoryContentAddressedStorage, type StorageReceipt } from '@socially-woke/storage';

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
} from '../src/index.js';

const programId = SOCIAL_PROTOCOL_EVENT_LAYOUT.programId;
const genesisHash = publicKey(7);
const networkId = `woke:v1:${genesisHash}:${programId}` as NetworkId;
const configAddress = publicKey(6);
const identityAddress = publicKey(9);
const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const rootAuthority = bs58.encode(ed25519.getPublicKey(privateKey));
const identityId = `swid:v1:${networkId}:${identityAddress}`;
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
  it('stays read-only until both network and program are explicit', () => {
    expect(readIndexerConfig({}).sync).toBeUndefined();
    expect(readIndexerConfig({ NEXT_PUBLIC_PROGRAM_ID: programId }).sync).toBeUndefined();
  });

  it('enables only a matching finalized network configuration', () => {
    expect(
      readIndexerConfig({
        INDEXER_NETWORK_ID: networkId,
        NEXT_PUBLIC_PROGRAM_ID: programId,
        WOKE_COMMITMENT: 'finalized',
      }).sync,
    ).toMatchObject({
      networkId,
      programId,
      deploymentSlot: 0n,
      batchSize: 100,
    });

    expect(() =>
      readIndexerConfig({
        INDEXER_NETWORK_ID: `woke:v1:${genesisHash}:${publicKey(88)}`,
        NEXT_PUBLIC_PROGRAM_ID: programId,
      }),
    ).toThrow('network program ID must match');
  });
});

describe('finalized Solana synchronization', () => {
  it('replays in deterministic transaction/log order and resumes idempotently', async () => {
    const storage = new MemoryContentAddressedStorage();
    const published = await storePost(storage);
    const rpc = new MockFinalizedRpc(
      12n,
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
    const projection = new MemoryProjectionStore();
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
      finalizedTip: 12n,
      signatures: 2,
      transactions: 2,
      decodedEvents: 2,
      appliedEvents: 2,
      duplicateEvents: 0,
      deadLetters: 0,
      checkpointAdvanced: true,
    });
    await expect(projection.checkpoint(networkId)).resolves.toBe(12n);
    await expect(
      projection.getFeed({ networkId, mode: 'chronological', limit: 10 }),
    ).resolves.toHaveLength(1);

    await expect(worker.runOnce()).resolves.toMatchObject({
      fromSlot: 12n,
      signatures: 0,
      appliedEvents: 0,
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

  it('backs off unavailable manifests, persists a dead letter, and recovers on replay', async () => {
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
    const projection = new MemoryProjectionStore();
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
      deadLetters: 1,
      checkpointAdvanced: false,
    });
    expect(retrySleeps).toContain(5);
    await expect(projection.checkpoint(networkId)).resolves.toBe(10n);
    await expect(projection.deadLetter(networkId, postSignature, 1)).resolves.toEqual({
      attempts: 1,
      nextAttemptAt: '2026-07-28T12:00:00.005Z',
    });

    await expect(worker.runOnce()).resolves.toMatchObject({
      deadLetters: 0,
      checkpointAdvanced: false,
    });
    await expect(projection.deadLetter(networkId, postSignature, 1)).resolves.toMatchObject({
      attempts: 1,
    });

    source.available = true;
    now += 6;
    await expect(worker.runOnce()).resolves.toMatchObject({
      appliedEvents: 1,
      duplicateEvents: 1,
      deadLetters: 0,
      checkpointAdvanced: true,
    });
    await expect(projection.deadLetter(networkId, postSignature, 1)).resolves.toBeUndefined();
    await expect(projection.checkpoint(networkId)).resolves.toBe(11n);
  });
});

interface WorkerFixture {
  readonly rpc: FinalizedSolanaRpc;
  readonly projection: MemoryProjectionStore;
  readonly indexer: OpenIndexer;
  readonly source: ManifestSource;
  readonly now?: () => number;
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

function postEventData(slot: bigint, receipt: StorageReceipt, envelope: SignedEnvelope): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.PostReferencePublished,
    u16(1),
    pubkey(configAddress),
    pubkey(publicKey(12)),
    pubkey(identityAddress),
    pubkey(rootAuthority),
    Uint8Array.from({ length: 16 }, (_, index) => 16 + index),
    u64(1n),
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
