import { ed25519 } from '@noble/curves/ed25519.js';
import type { PostResponse } from '@wokesocial/indexer-client';
import {
  buildPublishWokePostInstruction,
  derivePrimaryWokeIdentityCoordinates,
  type BuiltPublishWokePostInstruction,
  type ExecuteWokeInstructionInput,
  type WokeIdentityAccountRecord,
  type WokePostReferenceAccountRecord,
  type WokeProgramAccountReadRequest,
  type WokeProgramAccountSnapshot,
  type WokeTransactionExecutionResult,
} from '@wokesocial/sdk';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import type { PasskeyOperationSigner } from '../lib/auth/browser-auth-client';
import { encodeBase64Url } from '../lib/auth/passkey-codec';
import { createEmptyComposerDraft } from '../lib/composer-draft';
import {
  LocalnetFinalityRecoveryError,
  LocalnetTextPostPublicationError,
  publishLocalnetTextPost,
  recoverFinalizedPostTransaction,
  type LocalnetTextPostPublicationDependencies,
  type LocalnetTextPostPublicationStage,
} from '../lib/localnet-post-publication';
import type { LocalnetPublicationRuntime } from '../lib/localnet-publication-config';
import {
  POST_PUBLICATION_INTENT_STORAGE_KEY,
  loadPostPublicationIntent,
  type PostPublicationIntentStorage,
} from '../lib/post-publication-intent';

const GENESIS = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB';
const PROGRAM = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const SYSTEM = '11111111111111111111111111111111';
const NETWORK = `wokenet:v1:${GENESIS}:${PROGRAM}`;
const PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const PUBLIC_KEY = ed25519.getPublicKey(PRIVATE_KEY);
const ROOT = bs58.encode(PUBLIC_KEY);
const NOW = new Date('2026-07-29T12:00:00.000Z');
const IDENTITY_SIGNATURE = bs58.encode(new Uint8Array(64).fill(11));
const POST_SIGNATURE = bs58.encode(new Uint8Array(64).fill(22));
const RECOVERED_SIGNATURE = bs58.encode(new Uint8Array(64).fill(33));

const RUNTIME: LocalnetPublicationRuntime = {
  authServiceUrl: 'http://127.0.0.1:8787',
  context: {
    endpoint: 'http://127.0.0.1:8899',
    genesisHash: GENESIS,
    programAddress: PROGRAM,
  },
  indexerUrl: 'http://127.0.0.1:3002',
  networkId: NETWORK,
  targetBalanceLamports: 100_000_000,
};

class MemoryStorage implements PostPublicationIntentStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function draft(text = 'A passkey-first localnet post.') {
  const value = createEmptyComposerDraft();
  value.text = text;
  return value;
}

function authClient(options: { wrongSignature?: boolean; onSign?: () => void } = {}) {
  return {
    async withFreshPasskeySigner<Result>(
      operation: (signer: PasskeyOperationSigner) => Result | Promise<Result>,
    ): Promise<Result> {
      const publicKeyBytes = Uint8Array.from(PUBLIC_KEY);
      let active = true;
      try {
        return await operation(
          Object.freeze({
            credentialId: 'credential-1',
            publicKey: encodeBase64Url(PUBLIC_KEY),
            publicKeyBytes,
            sign(message: Uint8Array) {
              if (!active) throw new Error('expired signer');
              options.onSign?.();
              return options.wrongSignature
                ? new Uint8Array(64).fill(99)
                : ed25519.sign(message, PRIVATE_KEY);
            },
          }),
        );
      } finally {
        active = false;
        publicKeyBytes.fill(0);
      }
    },
  };
}

function identityRecord(sequence = 0n, createdAtSlot = 10n): WokeIdentityAccountRecord {
  return {
    version: 1,
    config: SYSTEM,
    identityNonce: new Uint8Array(16),
    originAuthority: ROOT,
    rootAuthority: ROOT,
    rootRotationCount: 0n,
    delegationSequence: 0n,
    sequence,
    profileSequence: 0n,
    profileManifestHash: new Uint8Array(32),
    profileManifestUri: '',
    createdAtSlot,
    profileUpdatedAtSlot: 0n,
    active: true,
    bump: 1,
  };
}

function postRecord(
  built: BuiltPublishWokePostInstruction,
  createdAtSlot = 20n,
): WokePostReferenceAccountRecord {
  return {
    version: 1,
    config: built.configAddress,
    authorIdentity: built.authorIdentity,
    postNonce: Uint8Array.from(built.postNonce),
    manifestHash: Uint8Array.from(built.manifestHash),
    manifestUri: built.manifestUri,
    authorSequence: built.expectedAuthorSequence + 1n,
    createdAtSlot,
    tombstonedAtSlot: null,
    bump: built.postReferenceBump,
  };
}

function snapshot(request: WokeProgramAccountReadRequest, slot = 30n): WokeProgramAccountSnapshot {
  return {
    address: request.address,
    owner: request.programAddress,
    commitment: request.commitment,
    slot,
    data: Uint8Array.of(1),
  };
}

function executionResult(
  input: ExecuteWokeInstructionInput,
  signature: string,
  slot: bigint,
): WokeTransactionExecutionResult {
  return {
    context: input.context,
    signature,
    slot,
    finalized: true,
    version: 'legacy',
    feePayer: input.feePayer,
    blockhash: GENESIS,
    lastValidBlockHeight: 100n,
    simulationSlot: slot,
    simulatedFeeLamports: 5_000n,
    minimumRentExemptBalances: Object.freeze({
      [String(input.rentExemptionSpaces?.[0] ?? 0)]: 2_500_000n,
    }),
    unitsConsumed: 1_000n,
    wireTransactionBase64: 'AQ==',
    wireTransactionByteLength: 1,
    sendAttempts: 1,
    confirmationAttempts: 1,
  };
}

async function invokeAndVerifySigner(
  input: ExecuteWokeInstructionInput,
  marker: number,
): Promise<void> {
  const messageBytes = Uint8Array.of(marker, 2, 3, 4);
  const signatures = await input.signer({
    purpose: 'wokenet-transaction-v1',
    context: input.context,
    version: 'legacy',
    feePayer: ROOT,
    instructionProgramAddress: PROGRAM,
    blockhash: GENESIS,
    lastValidBlockHeight: 100n,
    maxTransactionFeeLamports: 1_000_000n,
    messageBytes,
    requiredSignerAddresses: [ROOT],
    abortSignal: new AbortController().signal,
  });
  expect(signatures).toHaveLength(1);
  expect(signatures[0]?.address).toBe(ROOT);
  expect(
    ed25519.verify(signatures[0]?.signature ?? new Uint8Array(), messageBytes, PUBLIC_KEY),
  ).toBe(true);
}

interface HarnessOptions {
  readonly identityDisposition?: 'absent' | 'existing';
  readonly identitySequence?: () => bigint;
  readonly postDisposition?: () => 'ready' | 'existing';
  readonly executePost?: (
    input: ExecuteWokeInstructionInput,
    call: number,
  ) => Promise<WokeTransactionExecutionResult>;
  readonly putContent?: LocalnetTextPostPublicationDependencies['putContent'];
  readonly waitForPost?: LocalnetTextPostPublicationDependencies['waitForPost'];
  readonly recover?: LocalnetTextPostPublicationDependencies['recoverFinalizedPostTransaction'];
  readonly finalizedAccount?: (
    request: WokeProgramAccountReadRequest,
  ) => WokeProgramAccountSnapshot | null;
}

function harness(options: HarnessOptions = {}) {
  let randomCall = 0;
  let postExecutionCalls = 0;
  let contentPresent = false;
  let lastBuiltPost: BuiltPublishWokePostInstruction | undefined;
  const accountReads: WokeProgramAccountReadRequest[] = [];
  const identityDisposition = options.identityDisposition ?? 'existing';
  const postDisposition = options.postDisposition ?? (() => 'ready');
  const executePost =
    options.executePost ??
    (async (input: ExecuteWokeInstructionInput) => {
      await invokeAndVerifySigner(input, 2);
      return executionResult(input, POST_SIGNATURE, 20n);
    });
  const accountReader = {
    async readAccount(request: WokeProgramAccountReadRequest) {
      accountReads.push(request);
      return options.finalizedAccount === undefined
        ? snapshot(request)
        : options.finalizedAccount(request);
    },
  };
  const putContent =
    options.putContent ??
    vi.fn(async (bytes: Uint8Array, cid: string) => {
      const outcome = contentPresent ? ('already-present' as const) : ('stored' as const);
      contentPresent = true;
      return {
        outcome,
        receipt: {
          byteLength: bytes.byteLength,
          cid,
          locator: `local://${cid}`,
          policy: { permanence: 'deletion-compatible' as const },
          provider: 'local-filesystem' as const,
          providerVersion: '1' as const,
          schema: 'wokesocial.local-cas-receipt.v1' as const,
          verified: true as const,
        },
      };
    });
  const waitForPost =
    options.waitForPost ?? vi.fn(async () => ({ proof: 'indexed' }) as unknown as PostResponse);
  const recover =
    options.recover ??
    vi.fn(async () => ({
      signature: RECOVERED_SIGNATURE,
      slot: 20n,
    }));
  const dependencies: LocalnetTextPostPublicationDependencies = {
    accountReader,
    now: () => new Date(NOW),
    randomBytes(length) {
      randomCall += 1;
      return new Uint8Array(length).fill(randomCall);
    },
    putContent,
    ensureSignerBalance: vi.fn(async (_options, _root, target) => ({
      airdropSignature: null,
      balanceLamports: target,
      fundedLamports: 0,
      genesisHash: GENESIS,
    })),
    waitForIdentity: vi.fn(async (_options, expected) => ({
      active: true as const,
      identityId: expected.identityId,
      identitySequence: expected.minimumSequence,
      rootAuthority: expected.rootAuthority,
      rootRotationCount: 0n,
      updatedSlot: expected.minimumSlot,
    })),
    waitForPost,
    reconcileIdentity: vi.fn(async (built) =>
      identityDisposition === 'absent'
        ? { status: 'absent' as const }
        : {
            status: 'existing' as const,
            account: snapshot({
              endpoint: built.context.endpoint,
              genesisHash: built.context.genesisHash,
              programAddress: built.context.programAddress,
              address: built.identityAddress,
              commitment: 'processed',
            }),
            identity: identityRecord(options.identitySequence?.() ?? 0n),
          },
    ),
    verifyIdentity: vi.fn(() => identityRecord(options.identitySequence?.() ?? 0n)),
    verifyFreshIdentity: vi.fn(() => identityRecord(0n)),
    createIdentitySimulationVerifier: vi.fn(() => () => undefined),
    reconcilePost: vi.fn(async (built) => {
      lastBuiltPost = built;
      return postDisposition() === 'ready'
        ? {
            status: 'ready' as const,
            identity: identityRecord(options.identitySequence?.() ?? 0n),
          }
        : {
            status: 'existing' as const,
            account: snapshot({
              endpoint: built.context.endpoint,
              genesisHash: built.context.genesisHash,
              programAddress: built.context.programAddress,
              address: built.postReferenceAddress,
              commitment: 'processed',
            }),
            post: postRecord(built),
          };
    }),
    verifyPost: vi.fn((built) => postRecord(built)),
    createPostSimulationVerifier: vi.fn(() => () => undefined),
    executeInstruction: vi.fn(async (input) => {
      const isIdentity = input.rentExemptionSpaces?.[0] === 407;
      if (isIdentity) {
        await invokeAndVerifySigner(input, 1);
        return executionResult(input, IDENTITY_SIGNATURE, 10n);
      }
      postExecutionCalls += 1;
      return executePost(input, postExecutionCalls);
    }),
    recoverFinalizedPostTransaction: recover,
  };
  return {
    dependencies,
    accountReads,
    get postExecutionCalls() {
      return postExecutionCalls;
    },
    get lastBuiltPost() {
      return lastBuiltPost;
    },
    putContent,
    recover,
    waitForPost,
    deleteContent() {
      contentPresent = false;
    },
  };
}

describe('passkey-first localnet publication orchestration', () => {
  it('creates a missing identity, signs/stores/publishes one post, proves finality, and retires the exact intent', async () => {
    const storage = new MemoryStorage();
    const state = harness({ identityDisposition: 'absent' });
    const stages: LocalnetTextPostPublicationStage[] = [];
    let signCalls = 0;

    const result = await publishLocalnetTextPost({
      runtime: RUNTIME,
      authClient: authClient({ onSign: () => (signCalls += 1) }),
      storage,
      draft: draft(),
      expectedRootAuthority: ROOT,
      onProgress: ({ stage }) => stages.push(stage),
      dependencies: state.dependencies,
    });

    expect(result).toMatchObject({
      networkId: NETWORK,
      rootAuthority: ROOT,
      identity: {
        disposition: 'created',
        rentExemptLamports: 2_500_000n,
        sequence: 0n,
        transaction: { signature: IDENTITY_SIGNATURE, slot: 10n },
      },
      post: {
        body: 'A passkey-first localnet post.',
        disposition: 'published',
        rentExemptLamports: 2_500_000n,
        storageDisposition: 'stored',
        transaction: {
          signature: POST_SIGNATURE,
          slot: 20n,
          observedAuthorSequence: 1n,
          source: 'execution',
        },
      },
      finalizedIntent: { stage: 'finalized' },
    });
    expect(result.identity.id).toBe(`wokesocialid:v1:${NETWORK}:${result.identity.address}`);
    expect(result.finalizedIntent.context.rootSigningKey).toBe(
      `${result.identity.id}#root/${ROOT}`,
    );
    expect(signCalls).toBe(3);
    expect(state.postExecutionCalls).toBe(1);
    expect(state.accountReads.map(({ commitment }) => commitment)).toEqual([
      'finalized',
      'finalized',
    ]);
    expect(stages).toEqual([
      'authenticating',
      'deriving-identity',
      'reconciling-identity',
      'funding',
      'creating-identity',
      'reconciling-identity',
      'indexing-identity',
      'preparing-post',
      'signing-post',
      'storing-post',
      'reconciling-post',
      'publishing-post',
      'verifying-finality',
      'indexing-post',
      'verifying-content',
      'complete',
    ]);
    await expect(loadPostPublicationIntent(storage)).resolves.toMatchObject({
      stage: 'finalized',
      signed: { objectId: result.post.objectId },
    });
  });

  it('uses an existing finalized identity without sending create_identity', async () => {
    const storage = new MemoryStorage();
    const state = harness({
      identityDisposition: 'existing',
      identitySequence: () => 8n,
    });

    const result = await publishLocalnetTextPost({
      runtime: RUNTIME,
      authClient: authClient(),
      storage,
      draft: draft('Existing identity path.'),
      dependencies: state.dependencies,
    });

    expect(result.identity.disposition).toBe('existing');
    expect(result.identity.transaction).toBeNull();
    expect(result.identity.rentExemptLamports).toBeNull();
    expect(result.finalizedIntent.context.expectedAuthorSequence).toBe('8');
    expect(result.post.transaction.observedAuthorSequence).toBe(9n);
    expect(state.postExecutionCalls).toBe(1);
  });

  it('recovers a landed post on retry without re-signing, re-storing, or sending it twice', async () => {
    const storage = new MemoryStorage();
    let run = 0;
    let signerCalls = 0;
    const state = harness({
      identitySequence: () => (run === 0 ? 0n : 1n),
      postDisposition: () => (run === 0 ? 'ready' : 'existing'),
      async executePost(input) {
        await invokeAndVerifySigner(input, 9);
        throw new Error('forwarded sendTransaction response was lost');
      },
    });
    const first = publishLocalnetTextPost({
      runtime: RUNTIME,
      authClient: authClient({ onSign: () => (signerCalls += 1) }),
      storage,
      draft: draft('Response-loss-safe post.'),
      dependencies: state.dependencies,
    });
    await expect(first).rejects.toMatchObject({
      code: 'dependency-failure',
      stage: 'publishing-post',
    });
    const durableBeforeRetry = await loadPostPublicationIntent(storage);
    expect(durableBeforeRetry?.stage).toBe('stored');
    if (durableBeforeRetry?.stage !== 'stored') {
      throw new Error('Expected immutable stored retry evidence.');
    }
    expect(state.postExecutionCalls).toBe(1);
    expect(state.putContent).toHaveBeenCalledTimes(1);

    state.deleteContent();
    run = 1;
    const result = await publishLocalnetTextPost({
      runtime: RUNTIME,
      authClient: authClient({ onSign: () => (signerCalls += 1) }),
      storage,
      draft: draft('Response-loss-safe post.'),
      dependencies: state.dependencies,
    });

    expect(result.post.disposition).toBe('reconciled');
    expect(result.post.storageDisposition).toBe('stored');
    expect(result.post.transaction).toEqual({
      signature: RECOVERED_SIGNATURE,
      slot: 20n,
      observedAuthorSequence: 1n,
      source: 'rpc-recovery',
    });
    expect(result.post.storageReceipt).toEqual(durableBeforeRetry.storageReceipt);
    expect(result.finalizedIntent.context.postPda).toBe(durableBeforeRetry.context.postPda);
    expect(state.postExecutionCalls).toBe(1);
    expect(state.putContent).toHaveBeenCalledTimes(3);
    expect(state.recover).toHaveBeenCalledTimes(1);
    expect(signerCalls).toBe(2);
    await expect(loadPostPublicationIntent(storage)).resolves.toMatchObject({
      stage: 'finalized',
      signed: { objectId: result.post.objectId },
    });
  });

  it('reuses durable finality after an indexer timeout without resending or invoking recovery', async () => {
    const storage = new MemoryStorage();
    let indexAttempts = 0;
    let run = 0;
    const state = harness({
      identitySequence: () => (run === 0 ? 0n : 1n),
      postDisposition: () => (run === 0 ? 'ready' : 'existing'),
      waitForPost: vi.fn(async () => {
        indexAttempts += 1;
        if (indexAttempts === 1) throw new Error('index checkpoint timeout');
        return { proof: 'indexed' } as unknown as PostResponse;
      }),
    });

    await expect(
      publishLocalnetTextPost({
        runtime: RUNTIME,
        authClient: authClient(),
        storage,
        draft: draft('Indexer retry.'),
        dependencies: state.dependencies,
      }),
    ).rejects.toMatchObject({ code: 'dependency-failure', stage: 'indexing-post' });
    expect((await loadPostPublicationIntent(storage))?.stage).toBe('finalized');

    run = 1;
    const result = await publishLocalnetTextPost({
      runtime: RUNTIME,
      authClient: authClient(),
      storage,
      draft: createEmptyComposerDraft(),
      dependencies: state.dependencies,
    });
    expect(result.post.transaction.source).toBe('durable-intent');
    expect(result.post.transaction.signature).toBe(POST_SIGNATURE);
    expect(state.postExecutionCalls).toBe(1);
    expect(state.recover).not.toHaveBeenCalled();
    expect(state.putContent).toHaveBeenCalledTimes(3);
  });

  it('refuses success when the final exact-byte content revalidation fails', async () => {
    const storage = new MemoryStorage();
    let writes = 0;
    const state = harness({
      putContent: vi.fn(async (bytes, cid) => {
        writes += 1;
        if (writes === 2) throw new Error('content disappeared before success');
        return {
          outcome: 'stored' as const,
          receipt: {
            byteLength: bytes.byteLength,
            cid,
            locator: `local://${cid}`,
            policy: { permanence: 'deletion-compatible' as const },
            provider: 'local-filesystem' as const,
            providerVersion: '1' as const,
            schema: 'wokesocial.local-cas-receipt.v1' as const,
            verified: true as const,
          },
        };
      }),
    });

    await expect(
      publishLocalnetTextPost({
        runtime: RUNTIME,
        authClient: authClient(),
        storage,
        draft: draft('Final storage verification.'),
        dependencies: state.dependencies,
      }),
    ).rejects.toMatchObject({
      code: 'dependency-failure',
      stage: 'verifying-content',
    });
    expect(state.postExecutionCalls).toBe(1);
    expect(await loadPostPublicationIntent(storage)).toMatchObject({
      stage: 'finalized',
    });
  });

  it.each([
    {
      name: 'payload signature',
      expectedCode: 'dependency-failure',
      expectedStage: 'signing-post',
      configure: () => ({
        auth: authClient({ wrongSignature: true }),
        state: harness(),
      }),
    },
    {
      name: 'content storage',
      expectedCode: 'dependency-failure',
      expectedStage: 'storing-post',
      configure: () => ({
        auth: authClient(),
        state: harness({
          putContent: vi.fn(async () => {
            throw new Error('CAS unavailable');
          }),
        }),
      }),
    },
    {
      name: 'finalized account',
      expectedCode: 'finality-conflict',
      expectedStage: 'verifying-finality',
      configure: () => {
        let reads = 0;
        return {
          auth: authClient(),
          state: harness({
            finalizedAccount: (request) => {
              reads += 1;
              return reads === 1 ? snapshot(request) : null;
            },
          }),
        };
      },
    },
    {
      name: 'indexer checkpoint',
      expectedCode: 'dependency-failure',
      expectedStage: 'indexing-post',
      configure: () => ({
        auth: authClient(),
        state: harness({
          waitForPost: vi.fn(async () => {
            throw new Error('indexer unavailable');
          }),
        }),
      }),
    },
  ])('fails closed at the $name boundary and retains retry state', async (testCase) => {
    const storage = new MemoryStorage();
    const { auth, state } = testCase.configure();
    await expect(
      publishLocalnetTextPost({
        runtime: RUNTIME,
        authClient: auth,
        storage,
        draft: draft(`Failure at ${testCase.name}.`),
        dependencies: state.dependencies,
      }),
    ).rejects.toMatchObject({
      code: testCase.expectedCode,
      stage: testCase.expectedStage,
    });
    expect(storage.getItem(POST_PUBLICATION_INTENT_STORAGE_KEY)).not.toBeNull();
  });

  it('cancels before invoking the passkey and rejects remote runtime substitutions', async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn();
    await expect(
      publishLocalnetTextPost({
        runtime: RUNTIME,
        authClient: { withFreshPasskeySigner: operation },
        storage: new MemoryStorage(),
        draft: draft(),
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'aborted', stage: 'authenticating' });
    expect(operation).not.toHaveBeenCalled();

    await expect(
      publishLocalnetTextPost({
        runtime: {
          ...RUNTIME,
          context: { ...RUNTIME.context, endpoint: 'https://api.mainnet-beta.solana.com' },
        },
        authClient: authClient(),
        storage: new MemoryStorage(),
        draft: draft(),
      }),
    ).rejects.toMatchObject({ code: 'invalid-runtime' });

    const ipfsDraft = draft('Unsupported IPFS preference.');
    ipfsDraft.storagePolicy = 'ipfs';
    const passkey = vi.fn();
    await expect(
      publishLocalnetTextPost({
        runtime: RUNTIME,
        authClient: { withFreshPasskeySigner: passkey },
        storage: new MemoryStorage(),
        draft: ipfsDraft,
      }),
    ).rejects.toMatchObject({ code: 'invalid-input', stage: 'authenticating' });
    expect(passkey).not.toHaveBeenCalled();
  });

  it('fails closed when the fresh passkey key mismatches the disclosed destination', async () => {
    const readAccount = vi.fn();
    const storage = new MemoryStorage();
    const staleDestination = bs58.encode(new Uint8Array(32).fill(41));
    let signCalls = 0;
    await expect(
      publishLocalnetTextPost({
        runtime: RUNTIME,
        authClient: authClient({ onSign: () => (signCalls += 1) }),
        storage,
        draft: draft(),
        expectedRootAuthority: staleDestination,
        dependencies: { accountReader: { readAccount } },
      }),
    ).rejects.toMatchObject({ code: 'destination-mismatch', stage: 'deriving-identity' });
    expect(signCalls).toBe(0);
    expect(readAccount).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0);

    const passkey = vi.fn();
    await expect(
      publishLocalnetTextPost({
        runtime: RUNTIME,
        authClient: { withFreshPasskeySigner: passkey },
        storage: new MemoryStorage(),
        draft: draft(),
        expectedRootAuthority: 'not-a-canonical-destination',
      }),
    ).rejects.toMatchObject({ code: 'invalid-input', stage: 'authenticating' });
    expect(passkey).not.toHaveBeenCalled();
  });
});

async function recoveryFixture() {
  const coordinates = await derivePrimaryWokeIdentityCoordinates(RUNTIME.context, ROOT);
  const built = await buildPublishWokePostInstruction(RUNTIME.context, {
    authorIdentity: coordinates.identityAddress,
    expectedAuthorSequence: 0n,
    manifestHash: new Uint8Array(32).fill(7),
    manifestUri: `ipfs://bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
    payer: ROOT,
    postNonce: new Uint8Array(16).fill(8),
    rootAuthority: ROOT,
  });
  return { built, post: postRecord(built) };
}

interface MutableRecoveryTransaction {
  blockTime: number;
  meta: { err: unknown };
  slot: number;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: {
        pubkey: string;
        signer: boolean;
        source?: string;
        writable: boolean;
      }[];
      instructions: {
        accounts: string[];
        data: string;
        programId: string;
        stackHeight?: null;
      }[];
      recentBlockhash: string;
    };
  };
  version: string;
}

function recoveryFetch(
  built: BuiltPublishWokePostInstruction,
  overrides: {
    readonly genesisAfter?: string;
    readonly signatures?: readonly unknown[];
    readonly transaction?: unknown;
  } = {},
) {
  let genesisCalls = 0;
  const requests: { method: string; params: unknown[] }[] = [];
  const defaultSignatures = [
    {
      blockTime: 1,
      confirmationStatus: 'finalized',
      err: null,
      memo: null,
      signature: RECOVERED_SIGNATURE,
      slot: 20,
    },
  ];
  const defaultTransaction: MutableRecoveryTransaction = {
    blockTime: 1,
    meta: { err: null },
    slot: 20,
    transaction: {
      signatures: [RECOVERED_SIGNATURE],
      message: {
        accountKeys: [
          ROOT,
          ...new Set(built.instruction.accounts.map((account) => String(account.address))),
          PROGRAM,
        ]
          .filter((value, index, values) => values.indexOf(value) === index)
          .map((pubkey, index) => ({
            pubkey,
            signer: index === 0,
            source: 'transaction',
            writable: index === 0,
          })),
        instructions: [
          {
            accounts: built.instruction.accounts.map((account) => String(account.address)),
            data: bs58.encode(built.instruction.data),
            programId: PROGRAM,
            stackHeight: null,
          },
        ],
        recentBlockhash: GENESIS,
      },
    },
    version: 'legacy',
  };
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      id: string;
      method: string;
      params: unknown[];
    };
    requests.push({ method: body.method, params: body.params });
    let result: unknown;
    if (body.method === 'getGenesisHash') {
      genesisCalls += 1;
      result = genesisCalls === 2 ? (overrides.genesisAfter ?? GENESIS) : GENESIS;
    } else if (body.method === 'getSignaturesForAddress') {
      result = overrides.signatures ?? defaultSignatures;
    } else if (body.method === 'getTransaction') {
      result = overrides.transaction ?? defaultTransaction;
    } else {
      throw new Error(`Unexpected method ${body.method}`);
    }
    return new Response(JSON.stringify({ id: body.id, jsonrpc: '2.0', result }), {
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fetch, requests, defaultTransaction };
}

describe('strict finalized PostReference transaction recovery', () => {
  it('binds genesis before and after and verifies the exact signer, program, accounts, and data', async () => {
    const { built, post } = await recoveryFixture();
    const rpc = recoveryFetch(built);
    const recovered = await recoverFinalizedPostTransaction({
      built,
      post,
      fetch: rpc.fetch,
    });
    expect(recovered).toEqual({ signature: RECOVERED_SIGNATURE, slot: 20n });
    expect(rpc.requests.map(({ method }) => method)).toEqual([
      'getGenesisHash',
      'getSignaturesForAddress',
      'getTransaction',
      'getGenesisHash',
    ]);
    expect(rpc.requests[1]?.params).toEqual([
      built.postReferenceAddress,
      { commitment: 'finalized', limit: 100 },
    ]);
    expect(rpc.requests[2]?.params).toEqual([
      RECOVERED_SIGNATURE,
      {
        commitment: 'finalized',
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
      },
    ]);
  });

  it('rejects remote RPC, cancellation, genesis changes, and ambiguous creation slots', async () => {
    const { built, post } = await recoveryFixture();
    await expect(
      recoverFinalizedPostTransaction({
        built: {
          ...built,
          context: { ...built.context, endpoint: 'https://api.mainnet-beta.solana.com' },
        },
        post,
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });

    const controller = new AbortController();
    controller.abort();
    await expect(
      recoverFinalizedPostTransaction({ built, post, abortSignal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });

    await expect(
      recoverFinalizedPostTransaction({
        built,
        post,
        fetch: recoveryFetch(built, { genesisAfter: PROGRAM }).fetch,
      }),
    ).rejects.toMatchObject({ code: 'network-mismatch' });

    const candidate = {
      confirmationStatus: 'finalized',
      err: null,
      memo: null,
      signature: RECOVERED_SIGNATURE,
      slot: 20,
    };
    await expect(
      recoverFinalizedPostTransaction({
        built,
        post,
        fetch: recoveryFetch(built, { signatures: [candidate, candidate] }).fetch,
      }),
    ).rejects.toMatchObject({ code: 'ambiguous' });
  });

  it.each([
    {
      name: 'fee payer flags',
      mutate(transaction: MutableRecoveryTransaction) {
        firstRecoveryAccount(transaction).signer = false;
      },
    },
    {
      name: 'program id',
      mutate(transaction: MutableRecoveryTransaction) {
        firstRecoveryInstruction(transaction).programId = GENESIS;
      },
    },
    {
      name: 'instruction accounts',
      mutate(transaction: MutableRecoveryTransaction) {
        const instruction = firstRecoveryInstruction(transaction);
        instruction.accounts = instruction.accounts.slice(1);
      },
    },
    {
      name: 'instruction data',
      mutate(transaction: MutableRecoveryTransaction) {
        firstRecoveryInstruction(transaction).data = bs58.encode(new Uint8Array(4).fill(9));
      },
    },
    {
      name: 'transaction failure',
      mutate(transaction: MutableRecoveryTransaction) {
        transaction.meta.err = { InstructionError: [0, 'Custom'] };
      },
    },
    {
      name: 'additional signer',
      mutate(transaction: MutableRecoveryTransaction) {
        transaction.transaction.message.accountKeys.push({
          pubkey: GENESIS,
          signer: true,
          writable: false,
        });
      },
    },
    {
      name: 'duplicate account key',
      mutate(transaction: MutableRecoveryTransaction) {
        transaction.transaction.message.accountKeys.push({
          ...firstRecoveryAccount(transaction),
        });
      },
    },
    {
      name: 'transaction version',
      mutate(transaction: MutableRecoveryTransaction) {
        transaction.version = '0';
      },
    },
  ])('rejects $name substitution', async ({ mutate }) => {
    const { built, post } = await recoveryFixture();
    const rpc = recoveryFetch(built);
    const transaction = structuredClone(rpc.defaultTransaction);
    mutate(transaction);
    await expect(
      recoverFinalizedPostTransaction({
        built,
        post,
        fetch: recoveryFetch(built, { transaction }).fetch,
      }),
    ).rejects.toBeInstanceOf(LocalnetFinalityRecoveryError);
  });

  it('wraps recovery failures with the UI-facing stage and preserves the cause', async () => {
    const wrapped = new LocalnetTextPostPublicationError(
      'transaction-recovery-failed',
      'verifying-finality',
      'recovery failed',
      { cause: new LocalnetFinalityRecoveryError('ambiguous', 'ambiguous') },
    );
    expect(wrapped).toMatchObject({
      code: 'transaction-recovery-failed',
      stage: 'verifying-finality',
      cause: { code: 'ambiguous' },
    });
  });
});

function firstRecoveryAccount(transaction: MutableRecoveryTransaction) {
  const account = transaction.transaction.message.accountKeys[0];
  if (account === undefined) throw new Error('Recovery fixture has no fee payer.');
  return account;
}

function firstRecoveryInstruction(transaction: MutableRecoveryTransaction) {
  const instruction = transaction.transaction.message.instructions[0];
  if (instruction === undefined) throw new Error('Recovery fixture has no instruction.');
  return instruction;
}
