import { ed25519 } from '@noble/curves/ed25519.js';
import {
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
} from '@solana/kit';
import bs58 from 'bs58';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WOKENET_SYSTEM_PROGRAM_ADDRESS,
  WokeTransactionExecutionError,
  buildSendWokeTipInstruction,
  buildSettleWokeSubscriptionInstruction,
  executeWokeInstruction,
  executeWokeInstructions,
  executeWokePaymentTransaction,
  type BuiltWokeSettlementInstruction,
  type BuiltWokeSubscriptionSettlementInstruction,
  type BuiltWokeTipInstruction,
  type WokeTransactionSigner,
  type WokeTransactionSigningRequest,
} from '../src/index.js';

const WOKE_TIP_SETTLED_DISCRIMINATOR = Uint8Array.of(142, 81, 75, 163, 58, 30, 248, 115);
const SUBSCRIPTION_SETTLED_DISCRIMINATOR = Uint8Array.of(146, 48, 250, 127, 131, 180, 247, 174);
const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const signerAddress = bs58.encode(ed25519.getPublicKey(privateKey));
const secondPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 33);
const secondSignerAddress = bs58.encode(ed25519.getPublicKey(secondPrivateKey));
const key = (byte: number): string => bs58.encode(Uint8Array.from({ length: 32 }, () => byte));
const nonce = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const secondNonce = Uint8Array.from({ length: 16 }, (_, index) => index + 17);
const manifestHash = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const refundPolicyHash = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);

const context = {
  endpoint: 'https://rpc.network.wetdrool.com',
  genesisHash: key(7),
  programAddress: key(8),
} as const;
const blockhash = key(90);
const minimumRentExemptBalance = 1_234_560;

interface RpcRequestBody {
  readonly id: string | number;
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: readonly unknown[];
}

interface MockRpcOptions {
  readonly genesisHash?: string;
  readonly genesisHashes?: readonly string[];
  readonly replacementBlockhash?: unknown;
  readonly simulationError?: unknown;
  readonly simulationFeeLamports?: number;
  readonly simulationLogs?: readonly string[] | null;
  readonly preAccountContextSlots?: readonly number[];
  readonly feeContextSlots?: readonly number[];
  readonly simulationContextSlots?: readonly number[];
  readonly mutateTransfers?: (
    transfers: readonly Record<string, unknown>[],
  ) => readonly Record<string, unknown>[];
  readonly mutateInnerInstructions?: (groups: readonly Record<string, unknown>[]) => unknown;
  readonly mutateAccountBalances?: (input: {
    readonly addresses: readonly string[];
    readonly preBalances: readonly number[];
    readonly postBalances: readonly number[];
  }) => {
    readonly preBalances: readonly number[];
    readonly postBalances: readonly number[];
  };
  readonly sendSignature?: string;
  readonly failSendAttempts?: number;
  readonly statusSequence?: readonly (null | {
    readonly slot: number;
    readonly confirmations: number | null;
    readonly err: unknown;
    readonly confirmationStatus: 'processed' | 'confirmed' | 'finalized';
    readonly status: { readonly Ok: null } | { readonly Err: unknown };
  })[];
  readonly blockHeight?: number;
  readonly statusContextSlot?: number;
}

interface MockRpc {
  readonly requests: RpcRequestBody[];
  readonly simulationResponseValues: readonly Record<string, unknown>[];
  readonly simulatedTransactions: string[];
  readonly sentTransactions: string[];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function builtTip(rentPayer = signerAddress): Promise<BuiltWokeTipInstruction> {
  return buildSendWokeTipInstruction(context, {
    payerIdentity: key(4),
    payerAuthority: signerAddress,
    recipientIdentity: key(10),
    recipientDestination: key(11),
    feeDestination: key(6),
    rentPayer,
    receiptNonce: nonce,
    expectedPaymentPolicySequence: 7n,
    expectedFeeBasisPoints: 250,
    expectedPayerRootRotationCount: 2n,
    grossLamports: 101n,
  });
}

async function builtSubscription(): Promise<BuiltWokeSubscriptionSettlementInstruction> {
  return buildSettleWokeSubscriptionInstruction(context, {
    payerIdentity: key(4),
    payerAuthority: signerAddress,
    creatorIdentity: key(10),
    creatorDestination: key(11),
    offeringNonce: nonce,
    feeDestination: key(6),
    rentPayer: signerAddress,
    receiptNonce: secondNonce,
    expectedPaymentPolicySequence: 7n,
    expectedFeeBasisPoints: 250,
    expectedPayerRootRotationCount: 2n,
    expectedOfferingStateSequence: 4n,
    expectedOfferingManifestHash: manifestHash,
    expectedRefundPolicyHash: refundPolicyHash,
    expectedPriceLamports: 101n,
    entitlement: { kind: 'new' },
    recipientSplits: [
      {
        recipientIdentity: key(14),
        destination: key(15),
        basisPoints: 2_500,
      },
      {
        recipientIdentity: key(10),
        destination: key(11),
        basisPoints: 5_000,
      },
      {
        recipientIdentity: key(12),
        destination: key(13),
        basisPoints: 2_500,
      },
    ],
  });
}

function signer(
  mutateRequest?: (request: WokeTransactionSigningRequest) => Uint8Array,
): WokeTransactionSigner {
  return (request) => {
    const message = mutateRequest?.(request) ?? request.messageBytes;
    return [
      {
        address: signerAddress,
        signature: ed25519.sign(message, privateKey),
      },
    ];
  };
}

function installMockRpc(
  built: BuiltWokeSettlementInstruction,
  options: MockRpcOptions = {},
): MockRpc {
  const requests: RpcRequestBody[] = [];
  const simulationResponseValues: Record<string, unknown>[] = [];
  const simulatedTransactions: string[] = [];
  const sentTransactions: string[] = [];
  let sendAttempt = 0;
  let statusAttempt = 0;
  let genesisAttempt = 0;
  let preAccountAttempt = 0;
  let feeAttempt = 0;
  let simulationAttempt = 0;
  let pendingBalances:
    | {
        readonly addresses: readonly string[];
        readonly preBalances: readonly number[];
        readonly postBalances: readonly number[];
      }
    | undefined;
  const statusSequence = options.statusSequence ?? [
    {
      slot: 120,
      confirmations: 1,
      err: null,
      confirmationStatus: 'confirmed',
      status: { Ok: null },
    },
    {
      slot: 121,
      confirmations: null,
      err: null,
      confirmationStatus: 'finalized',
      status: { Ok: null },
    },
  ];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (requestUrl: string | URL | Request, init?: RequestInit) => {
      expect(String(requestUrl)).toBe('https://rpc.network.wetdrool.com/');
      expect(init).toMatchObject({
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
      const body = parseRequestBody(init?.body);
      requests.push(body);
      let result: unknown;
      switch (body.method) {
        case 'getGenesisHash':
          result =
            options.genesisHashes?.[Math.min(genesisAttempt++, options.genesisHashes.length - 1)] ??
            options.genesisHash ??
            context.genesisHash;
          break;
        case 'getLatestBlockhash':
          result = {
            context: { slot: 100 },
            value: { blockhash, lastValidBlockHeight: 200 },
          };
          break;
        case 'getMinimumBalanceForRentExemption':
          result = minimumRentExemptBalance;
          break;
        case 'getMultipleAccounts': {
          const addresses = readAddressParams(body);
          const simulationFeeLamports = options.simulationFeeLamports ?? 5_000;
          const defaultBalances = buildSimulationAccountBalances(
            addresses,
            built,
            simulationFeeLamports,
          );
          const balances = options.mutateAccountBalances?.(defaultBalances) ?? defaultBalances;
          pendingBalances = {
            addresses,
            preBalances: balances.preBalances,
            postBalances: balances.postBalances,
          };
          result = {
            context: {
              slot: indexedSlot(options.preAccountContextSlots, preAccountAttempt++, 101),
            },
            value: pendingBalances.preBalances.map(rpcAccountSnapshot),
          };
          break;
        }
        case 'getFeeForMessage':
          result = {
            context: { slot: indexedSlot(options.feeContextSlots, feeAttempt++, 101) },
            value: options.simulationFeeLamports ?? 5_000,
          };
          break;
        case 'simulateTransaction': {
          const transaction = readTransactionParam(body);
          simulatedTransactions.push(transaction);
          const requestedAddresses = readSimulationAccountAddresses(body);
          if (
            pendingBalances === undefined ||
            pendingBalances.addresses.length !== requestedAddresses.length ||
            pendingBalances.addresses.some(
              (accountAddress, index) => accountAddress !== requestedAddresses[index],
            )
          ) {
            throw new TypeError('Simulation account request does not match its pre-state query.');
          }
          const transfers = built.plan.transfers.map((transfer): Record<string, unknown> => ({
            program: 'system',
            programId: WOKENET_SYSTEM_PROGRAM_ADDRESS,
            stackHeight: 2,
            parsed: {
              type: 'transfer',
              info: {
                source: transfer.source,
                destination: transfer.destination,
                lamports: Number(transfer.lamports),
              },
            },
          }));
          const rentPayer = built.instruction.accounts[built.kind === 'woke-tip' ? 8 : 10]?.address;
          if (rentPayer === undefined) throw new TypeError('Rent payer missing.');
          const accountCreations: readonly Record<string, unknown>[] = [
            ...(built.kind === 'weekly-subscription' && built.priorStartedAtTimestamp === null
              ? [
                  systemAccountCreation(
                    rentPayer,
                    built.entitlementAddress,
                    210,
                    built.context.programAddress,
                  ),
                ]
              : []),
            systemAccountCreation(
              rentPayer,
              built.receiptAddress,
              457,
              built.context.programAddress,
            ),
          ];
          const systemInstructions: readonly Record<string, unknown>[] = [
            ...accountCreations,
            ...transfers,
          ];
          const innerInstructionGroups: readonly Record<string, unknown>[] = [
            {
              index: 0,
              instructions: options.mutateTransfers?.(systemInstructions) ?? systemInstructions,
            },
          ];
          const defaultLogs = [
            `Program ${context.programAddress} invoke [1]`,
            `Program data: ${Buffer.from(encodeSettlementEvent(built)).toString('base64')}`,
            `Program ${context.programAddress} success`,
          ];
          const simulationValue: Record<string, unknown> = {
            accounts: pendingBalances.postBalances.map(rpcAccountSnapshot),
            err: options.simulationError ?? null,
            innerInstructions:
              options.mutateInnerInstructions?.(innerInstructionGroups) ?? innerInstructionGroups,
            loadedAccountsDataSize: 0,
            logs: Object.hasOwn(options, 'simulationLogs') ? options.simulationLogs : defaultLogs,
            replacementBlockhash: options.replacementBlockhash ?? null,
            returnData: null,
            unitsConsumed: 59_000,
          };
          simulationResponseValues.push(simulationValue);
          result = {
            context: {
              apiVersion: '2.3.0',
              slot: indexedSlot(options.simulationContextSlots, simulationAttempt++, 101),
            },
            value: simulationValue,
          };
          break;
        }
        case 'getBlockHeight':
          result = options.blockHeight ?? 110;
          break;
        case 'sendTransaction': {
          sendAttempt += 1;
          const transaction = readTransactionParam(body);
          sentTransactions.push(transaction);
          if (sendAttempt <= (options.failSendAttempts ?? 0)) {
            return jsonRpcError(body.id, -32005, 'temporarily unavailable');
          }
          result = options.sendSignature ?? signatureFromWireTransaction(transaction);
          break;
        }
        case 'getSignatureStatuses':
          result = {
            context: { slot: options.statusContextSlot ?? 122 },
            value:
              statusAttempt < statusSequence.length
                ? [statusSequence[statusAttempt++] ?? null]
                : [statusSequence.at(-1) ?? null],
          };
          break;
        default:
          throw new Error(`Unexpected RPC method: ${body.method}`);
      }
      return jsonRpcResult(body.id, result);
    }),
  );
  return { requests, simulationResponseValues, simulatedTransactions, sentTransactions };
}

function executionLimits() {
  return {
    maxConfirmationAttempts: 5,
    maxSendAttempts: 3,
    overallTimeoutMs: 5_000,
    pollIntervalMs: 0,
    rebroadcastEveryAttempts: 1,
    requestTimeoutMs: 1_000,
  } as const;
}

describe('DroolNet transaction execution', () => {
  it('compiles an ordered instruction set into one atomic signed transaction', async () => {
    const built = await builtTip();
    installMockRpc(built, {
      mutateInnerInstructions: (groups) => [...groups, { index: 1, instructions: [] }],
      statusSequence: [
        {
          slot: 121,
          confirmations: null,
          err: null,
          confirmationStatus: 'finalized',
          status: { Ok: null },
        },
      ],
    });

    const result = await executeWokeInstructions({
      context: built.context,
      instructions: [built.instruction, built.instruction],
      feePayer: signerAddress,
      signer: signer(),
      verifySimulation: () => undefined,
      limits: executionLimits(),
    });

    const transaction = getTransactionDecoder().decode(
      getBase64Encoder().encode(result.wireTransactionBase64),
    );
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    expect(message.version).toBe(0);
    if (message.version !== 0) throw new Error('Expected a version-0 transaction message.');
    expect(message.instructions).toHaveLength(2);
    expect(message.instructions[0]?.data).toEqual(message.instructions[1]?.data);
  });

  it('rejects empty and over-bounded atomic instruction sets before RPC access', async () => {
    const built = await builtTip();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const execute = (instructions: readonly (typeof built.instruction)[]) =>
      executeWokeInstructions({
        context: built.context,
        instructions,
        feePayer: signerAddress,
        signer: signer(),
        verifySimulation: () => undefined,
        limits: executionLimits(),
      });

    await expect(execute([])).rejects.toMatchObject({ code: 'invalid-instruction' });
    await expect(
      execute(Array.from({ length: 17 }, () => built.instruction)),
    ).rejects.toMatchObject({
      code: 'invalid-instruction',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses Agave-standard slot-bound fee/account evidence for the exact bytes before broadcast', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built);
    const operationSigner = vi.fn(signer());

    const result = await executeWokePaymentTransaction({
      built,
      feePayer: signerAddress,
      signer: operationSigner,
      limits: executionLimits(),
    });

    expect(result).toMatchObject({
      context: { ...context, endpoint: 'https://rpc.network.wetdrool.com/' },
      finalized: true,
      version: 0,
      feePayer: signerAddress,
      blockhash,
      lastValidBlockHeight: 200n,
      simulationSlot: 101n,
      simulatedFeeLamports: 5_000n,
      minimumRentExemptBalances: {
        '457': BigInt(minimumRentExemptBalance),
      },
      unitsConsumed: 59_000n,
      slot: 121n,
      sendAttempts: 1,
      confirmationAttempts: 2,
    });
    expect(Object.isFrozen(result.minimumRentExemptBalances)).toBe(true);
    expect(() => {
      (result.minimumRentExemptBalances as Record<string, bigint>)['457'] = 0n;
    }).toThrow(TypeError);
    expect(result.minimumRentExemptBalances).toEqual({
      '457': BigInt(minimumRentExemptBalance),
    });
    expect(operationSigner).toHaveBeenCalledOnce();
    const signingRequest = operationSigner.mock.calls[0]?.[0];
    expect(signingRequest).toMatchObject({
      purpose: 'droolnet-transaction-v1',
      version: 0,
      feePayer: signerAddress,
      instructionProgramAddress: context.programAddress,
      blockhash,
      lastValidBlockHeight: 200n,
      maxTransactionFeeLamports: 1_000_000n,
      requiredSignerAddresses: [signerAddress],
    });
    expect(rpc.simulatedTransactions).toEqual([result.wireTransactionBase64]);
    expect(rpc.sentTransactions).toEqual([result.wireTransactionBase64]);
    expect(rpc.simulationResponseValues).toHaveLength(1);
    expect(Object.hasOwn(rpc.simulationResponseValues[0] ?? {}, 'fee')).toBe(false);
    expect(Object.hasOwn(rpc.simulationResponseValues[0] ?? {}, 'preBalances')).toBe(false);
    expect(Object.hasOwn(rpc.simulationResponseValues[0] ?? {}, 'postBalances')).toBe(false);

    const simulationRequest = rpc.requests.find(
      (request) => request.method === 'simulateTransaction',
    );
    expect(simulationRequest?.params?.[1]).toMatchObject({
      encoding: 'base64',
      innerInstructions: true,
      minContextSlot: 101,
      replaceRecentBlockhash: false,
      sigVerify: true,
    });
    const preAccountRequest = rpc.requests.find(
      (request) => request.method === 'getMultipleAccounts',
    );
    expect(preAccountRequest?.params?.[1]).toEqual({
      commitment: 'confirmed',
      dataSlice: { length: 0, offset: 0 },
      encoding: 'base64',
      minContextSlot: 100,
    });
    expect(
      (simulationRequest?.params?.[1] as { readonly accounts?: unknown } | undefined)?.accounts,
    ).toEqual({
      addresses: preAccountRequest?.params?.[0],
      encoding: 'base64',
    });
    const feeRequest = rpc.requests.find((request) => request.method === 'getFeeForMessage');
    const exactTransaction = getTransactionDecoder().decode(
      getBase64Encoder().encode(result.wireTransactionBase64),
    );
    expect(feeRequest?.params).toEqual([
      getBase64Decoder().decode(exactTransaction.messageBytes),
      { commitment: 'confirmed', minContextSlot: 101 },
    ]);
    const sendRequest = rpc.requests.find((request) => request.method === 'sendTransaction');
    expect(sendRequest?.params?.[1]).toMatchObject({
      encoding: 'base64',
      maxRetries: 0,
      minContextSlot: 100,
      skipPreflight: true,
    });
    expect(rpc.requests.filter((request) => request.method === 'getGenesisHash')).toHaveLength(6);
  });

  it('retries the exact signed transaction when the confirmed bank advances between evidence RPCs', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built, {
      preAccountContextSlots: [101, 102],
      feeContextSlots: [101, 102],
      simulationContextSlots: [102, 102],
      statusSequence: [
        {
          slot: 121,
          confirmations: null,
          err: null,
          confirmationStatus: 'finalized',
          status: { Ok: null },
        },
      ],
    });

    const result = await executeWokePaymentTransaction({
      built,
      feePayer: signerAddress,
      signer: signer(),
      limits: executionLimits(),
    });

    expect(result.simulationSlot).toBe(102n);
    expect(rpc.requests.filter((request) => request.method === 'getMultipleAccounts')).toHaveLength(
      2,
    );
    expect(rpc.requests.filter((request) => request.method === 'getFeeForMessage')).toHaveLength(2);
    expect(rpc.requests.filter((request) => request.method === 'simulateTransaction')).toHaveLength(
      2,
    );
    expect(
      rpc.requests
        .filter((request) => request.method === 'simulateTransaction')
        .map(
          (request) =>
            (request.params?.[1] as { readonly minContextSlot?: number } | undefined)
              ?.minContextSlot,
        ),
    ).toEqual([101, 102]);
    expect(rpc.simulatedTransactions).toEqual([
      result.wireTransactionBase64,
      result.wireTransactionBase64,
    ]);
    expect(rpc.sentTransactions).toEqual([result.wireTransactionBase64]);
  });

  it('fails closed after a bounded number of attempts when confirmed-slot evidence never aligns', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built, {
      preAccountContextSlots: [101, 102, 103, 104, 105],
      feeContextSlots: [102, 103, 104, 105, 106],
    });

    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({
      code: 'simulation-mismatch',
      stage: 'simulating',
    });
    expect(rpc.requests.filter((request) => request.method === 'getMultipleAccounts')).toHaveLength(
      5,
    );
    expect(rpc.requests.filter((request) => request.method === 'getFeeForMessage')).toHaveLength(5);
    expect(rpc.requests.some((request) => request.method === 'simulateTransaction')).toBe(false);
    expect(rpc.sentTransactions).toHaveLength(0);
  });

  it('supports a legacy message without changing the exact-byte guarantees', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built, {
      statusSequence: [
        {
          slot: 121,
          confirmations: null,
          err: null,
          confirmationStatus: 'finalized',
          status: { Ok: null },
        },
      ],
    });

    const result = await executeWokePaymentTransaction({
      built,
      feePayer: signerAddress,
      signer: signer(),
      version: 'legacy',
      limits: executionLimits(),
    });

    expect(result.version).toBe('legacy');
    expect(rpc.simulatedTransactions[0]).toBe(result.wireTransactionBase64);
    expect(rpc.sentTransactions[0]).toBe(result.wireTransactionBase64);
  });

  it('returns an immutable defensive copy of the simulation-bound rent evidence', async () => {
    const built = await builtTip();
    installMockRpc(built, {
      statusSequence: [
        {
          slot: 121,
          confirmations: null,
          err: null,
          confirmationStatus: 'finalized',
          status: { Ok: null },
        },
      ],
    });
    let simulationRentEvidence: Readonly<Record<string, bigint>> | undefined;

    const result = await executeWokeInstruction({
      context: built.context,
      instruction: built.instruction,
      feePayer: signerAddress,
      signer: signer(),
      verifySimulation: (snapshot) => {
        simulationRentEvidence = snapshot.minimumRentExemptBalances;
      },
      rentExemptionSpaces: [457],
      limits: executionLimits(),
    });

    expect(simulationRentEvidence).toEqual({
      '457': BigInt(minimumRentExemptBalance),
    });
    expect(Object.isFrozen(simulationRentEvidence)).toBe(true);
    expect(result.minimumRentExemptBalances).toEqual(simulationRentEvidence);
    expect(result.minimumRentExemptBalances).not.toBe(simulationRentEvidence);
    expect(Object.isFrozen(result.minimumRentExemptBalances)).toBe(true);
  });

  it('decodes and verifies weekly-subscription transfers, event vectors, and both new accounts', async () => {
    const built = await builtSubscription();
    const rpc = installMockRpc(built, {
      statusSequence: [
        {
          slot: 121,
          confirmations: null,
          err: null,
          confirmationStatus: 'finalized',
          status: { Ok: null },
        },
      ],
    });

    const result = await executeWokePaymentTransaction({
      built,
      feePayer: signerAddress,
      signer: signer(),
      limits: executionLimits(),
    });

    expect(result.finalized).toBe(true);
    expect(result.minimumRentExemptBalances).toEqual({
      '210': BigInt(minimumRentExemptBalance),
      '457': BigInt(minimumRentExemptBalance),
    });
    expect(Object.isFrozen(result.minimumRentExemptBalances)).toBe(true);
    expect(rpc.simulatedTransactions).toEqual([result.wireTransactionBase64]);
    const simulation = rpc.requests.find((request) => request.method === 'simulateTransaction');
    const instructions = (
      simulation?.params?.[1] as { readonly innerInstructions?: boolean } | undefined
    )?.innerInstructions;
    expect(instructions).toBe(true);
  });

  it('requires and verifies every detached signature in a multi-signer payment', async () => {
    const built = await builtTip(secondSignerAddress);
    installMockRpc(built, {
      statusSequence: [
        {
          slot: 121,
          confirmations: null,
          err: null,
          confirmationStatus: 'finalized',
          status: { Ok: null },
        },
      ],
    });
    const operationSigner = vi.fn((request: WokeTransactionSigningRequest) =>
      [...request.requiredSignerAddresses].reverse().map((requiredAddress) => ({
        address: requiredAddress,
        signature: ed25519.sign(
          request.messageBytes,
          requiredAddress === signerAddress ? privateKey : secondPrivateKey,
        ),
      })),
    );

    const result = await executeWokePaymentTransaction({
      built,
      feePayer: signerAddress,
      signer: operationSigner,
      limits: executionLimits(),
    });

    expect(result.finalized).toBe(true);
    expect(operationSigner.mock.calls[0]?.[0].requiredSignerAddresses).toEqual([
      signerAddress,
      secondSignerAddress,
    ]);
  });

  it('rejects a duplicate signer address after matching the required signer cardinality', async () => {
    const built = await builtTip(secondSignerAddress);
    const rpc = installMockRpc(built);
    const duplicateSigner = vi.fn((request: WokeTransactionSigningRequest) => {
      const signature = ed25519.sign(request.messageBytes, privateKey);
      return [
        { address: signerAddress, signature },
        { address: signerAddress, signature },
      ];
    });

    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: duplicateSigner,
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({
      code: 'signer-mismatch',
      stage: 'signing',
      message: 'The signer returned an unexpected or duplicate signer address.',
    });
    expect(duplicateSigner.mock.calls[0]?.[0].requiredSignerAddresses).toHaveLength(2);
    expect(rpc.requests.some((request) => request.method === 'simulateTransaction')).toBe(false);
  });

  it('rejects signer mutation and a signature over anything except the compiled message', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built);

    const result = executeWokePaymentTransaction({
      built,
      feePayer: signerAddress,
      signer: signer((request) => {
        request.messageBytes[request.messageBytes.length - 1] =
          (request.messageBytes.at(-1) ?? 0) ^ 1;
        return request.messageBytes;
      }),
      limits: executionLimits(),
    });

    await expect(result).rejects.toMatchObject({
      code: 'invalid-signature',
      stage: 'signing',
    });
    expect(rpc.requests.some((request) => request.method === 'simulateTransaction')).toBe(false);
  });

  it('rejects missing, unexpected, and malformed detached signatures', async () => {
    const built = await builtTip();
    const cases: readonly {
      readonly name: string;
      readonly signer: WokeTransactionSigner;
      readonly code: string;
    }[] = [
      {
        name: 'missing',
        signer: () => [],
        code: 'signer-mismatch',
      },
      {
        name: 'unexpected',
        signer: (request) => [
          {
            address: key(44),
            signature: ed25519.sign(request.messageBytes, privateKey),
          },
        ],
        code: 'signer-mismatch',
      },
      {
        name: 'malformed',
        signer: () => [{ address: signerAddress, signature: new Uint8Array(63) }],
        code: 'invalid-signature',
      },
    ];

    for (const testCase of cases) {
      vi.unstubAllGlobals();
      const rpc = installMockRpc(built);
      await expect(
        executeWokePaymentTransaction({
          built,
          feePayer: signerAddress,
          signer: testCase.signer,
          limits: executionLimits(),
        }),
        testCase.name,
      ).rejects.toMatchObject({ code: testCase.code, stage: 'signing' });
      expect(rpc.requests.some((request) => request.method === 'simulateTransaction')).toBe(false);
    }
  });

  it('rejects an endpoint on a different genesis before asking the signer', async () => {
    const built = await builtTip();
    installMockRpc(built, { genesisHash: key(99) });
    const operationSigner = vi.fn(signer());

    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: operationSigner,
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({
      code: 'provider-mismatch',
      stage: 'identifying',
    });
    expect(operationSigner).not.toHaveBeenCalled();
  });

  it('rejects provider identity drift after signing and before simulation', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built, {
      genesisHashes: [context.genesisHash, key(99)],
    });
    const operationSigner = vi.fn(signer());

    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: operationSigner,
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({
      code: 'provider-mismatch',
      stage: 'identifying',
    });
    expect(operationSigner).toHaveBeenCalledOnce();
    expect(rpc.simulatedTransactions).toHaveLength(0);
  });

  it('rejects a provider-reported replacement blockhash before broadcast', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built, {
      replacementBlockhash: {
        blockhash: key(91),
        lastValidBlockHeight: 210,
      },
    });

    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({
      code: 'blockhash-substitution',
      stage: 'simulating',
    });
    expect(rpc.sentTransactions).toHaveLength(0);
  });

  it('rejects both failed simulations and successful simulations with substituted payment effects', async () => {
    const built = await builtTip();
    const failedRpc = installMockRpc(built, {
      simulationError: { InstructionError: [0, 'Custom'] },
    });
    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({ code: 'simulation-failed', stage: 'simulating' });
    expect(failedRpc.sentTransactions).toHaveLength(0);

    vi.unstubAllGlobals();
    const mismatchedRpc = installMockRpc(built, {
      mutateTransfers: (transfers) =>
        transfers.map((transfer) =>
          isParsedType(transfer, 'transfer')
            ? {
                ...transfer,
                parsed: {
                  type: 'transfer',
                  info: {
                    source: built.plan.payerAuthority,
                    destination: key(55),
                    lamports: Number(built.plan.feeLamports),
                  },
                },
              }
            : transfer,
        ),
    });
    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({ code: 'simulation-mismatch', stage: 'simulating' });
    expect(mismatchedRpc.sentTransactions).toHaveLength(0);
  });

  it('rejects an opaque System Program inner instruction rather than overlooking value movement', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built, {
      mutateTransfers: (transfers) => [
        ...transfers,
        {
          programId: WOKENET_SYSTEM_PROGRAM_ADDRESS,
          accounts: [signerAddress, key(56)],
          data: '3Bxs411Dtc7pkFQj',
          stackHeight: 2,
        },
      ],
    });

    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({ code: 'simulation-mismatch', stage: 'simulating' });
    expect(rpc.sentTransactions).toHaveLength(0);
  });

  it('rejects substituted rent account creation even when payment transfers match', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built, {
      mutateTransfers: (instructions) =>
        instructions.map((instruction) =>
          isParsedType(instruction, 'createAccount')
            ? {
                ...instruction,
                parsed: {
                  type: 'createAccount',
                  info: {
                    source: signerAddress,
                    newAccount: key(56),
                    owner: context.programAddress,
                    lamports: minimumRentExemptBalance,
                    space: 457,
                  },
                },
              }
            : instruction,
        ),
    });

    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({ code: 'simulation-mismatch', stage: 'simulating' });
    expect(rpc.sentTransactions).toHaveLength(0);
  });

  it('enforces the approved transaction-fee cap before broadcast', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built, { simulationFeeLamports: 1_000_001 });

    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({ code: 'fee-limit-exceeded', stage: 'simulating' });
    expect(rpc.simulatedTransactions).toHaveLength(0);
    expect(rpc.sentTransactions).toHaveLength(0);
  });

  it('rejects a direct native balance mutation that is absent from parsed System effects', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built, {
      mutateAccountBalances: ({ addresses, preBalances, postBalances }) => {
        const receiptIndex = addresses.indexOf(built.receiptAddress);
        if (receiptIndex < 0) throw new TypeError('Receipt missing from simulated balances.');
        const mutatedPostBalances = [...postBalances];
        mutatedPostBalances[receiptIndex] = (mutatedPostBalances[receiptIndex] ?? 0) - 1;
        return { preBalances, postBalances: mutatedPostBalances };
      },
    });

    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({ code: 'simulation-mismatch', stage: 'simulating' });
    expect(rpc.sentTransactions).toHaveLength(0);
  });

  it('bounds hostile simulation logs, inner instructions, and event payloads', async () => {
    const built = await builtTip();
    const oversizedLogsRpc = installMockRpc(built, {
      simulationLogs: Array.from({ length: 1_025 }, () => 'Program log: bounded'),
    });
    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({ code: 'invalid-rpc-response', stage: 'simulating' });
    expect(oversizedLogsRpc.sentTransactions).toHaveLength(0);

    vi.unstubAllGlobals();
    const oversizedInstructionsRpc = installMockRpc(built, {
      mutateInnerInstructions: () => [
        {
          index: 0,
          instructions: Array.from({ length: 65 }, () => ({
            programId: key(45),
            accounts: [],
            data: '',
          })),
        },
      ],
    });
    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({ code: 'invalid-rpc-response', stage: 'simulating' });
    expect(oversizedInstructionsRpc.sentTransactions).toHaveLength(0);

    vi.unstubAllGlobals();
    const oversizedEventRpc = installMockRpc(built, {
      simulationLogs: [
        `Program ${context.programAddress} invoke [1]`,
        `Program data: ${'A'.repeat(4_100)}`,
        `Program ${context.programAddress} success`,
      ],
    });
    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({ code: 'simulation-mismatch', stage: 'simulating' });
    expect(oversizedEventRpc.sentTransactions).toHaveLength(0);
  });

  it('rejects a broadcast response for any signature other than the exact fee-payer signature', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built, { sendSignature: bs58.encode(new Uint8Array(64).fill(77)) });

    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({
      code: 'broadcast-mismatch',
      stage: 'broadcasting',
    });
    expect(rpc.sentTransactions).toHaveLength(1);
  });

  it('rebroadcasts the same signed bytes after an ambiguous send failure and never re-signs', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built, {
      failSendAttempts: 1,
      statusSequence: [
        null,
        {
          slot: 121,
          confirmations: null,
          err: null,
          confirmationStatus: 'finalized',
          status: { Ok: null },
        },
      ],
    });
    const operationSigner = vi.fn(signer());

    const result = await executeWokePaymentTransaction({
      built,
      feePayer: signerAddress,
      signer: operationSigner,
      limits: executionLimits(),
    });

    expect(result.sendAttempts).toBe(2);
    expect(operationSigner).toHaveBeenCalledOnce();
    expect(rpc.sentTransactions).toEqual([
      result.wireTransactionBase64,
      result.wireTransactionBase64,
    ]);
  });

  it('treats a signature mismatch from an exact-byte rebroadcast as terminal', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built, {
      failSendAttempts: 1,
      sendSignature: bs58.encode(new Uint8Array(64).fill(77)),
      statusSequence: [
        null,
        {
          slot: 121,
          confirmations: null,
          err: null,
          confirmationStatus: 'finalized',
          status: { Ok: null },
        },
      ],
    });

    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({ code: 'broadcast-mismatch', stage: 'broadcasting' });
    expect(rpc.sentTransactions).toHaveLength(2);
  });

  it('rejects stale or internally contradictory finalized status responses', async () => {
    const built = await builtTip();
    installMockRpc(built, {
      statusSequence: [
        {
          slot: 121,
          confirmations: null,
          err: null,
          confirmationStatus: 'finalized',
          status: { Err: { InstructionError: [0, 'Custom'] } },
        },
      ],
    });
    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({ code: 'invalid-rpc-response', stage: 'confirming' });

    vi.unstubAllGlobals();
    installMockRpc(built, {
      statusContextSlot: 99,
      statusSequence: [null],
    });
    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({ code: 'invalid-rpc-response', stage: 'confirming' });
  });

  it('fails closed on expiration, transaction errors, and bounded confirmation exhaustion', async () => {
    const built = await builtTip();
    installMockRpc(built, {
      blockHeight: 201,
      statusSequence: [null],
    });
    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({ code: 'transaction-expired' });

    vi.unstubAllGlobals();
    installMockRpc(built, {
      statusSequence: [
        {
          slot: 121,
          confirmations: null,
          err: { InstructionError: [0, 'Custom'] },
          confirmationStatus: 'finalized',
          status: { Err: { InstructionError: [0, 'Custom'] } },
        },
      ],
    });
    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({ code: 'transaction-failed', stage: 'confirming' });

    vi.unstubAllGlobals();
    const boundedRpc = installMockRpc(built, {
      statusSequence: [null],
      blockHeight: 110,
    });
    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: {
          ...executionLimits(),
          maxConfirmationAttempts: 3,
          maxSendAttempts: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'confirmation-timeout', stage: 'confirming' });
    expect(
      boundedRpc.requests.filter((request) => request.method === 'getSignatureStatuses'),
    ).toHaveLength(3);
  });

  it('rejects a context-program substitution before making an RPC request', async () => {
    const built = await builtTip();
    const rpc = installMockRpc(built);
    const substituted = {
      ...built,
      instruction: {
        ...built.instruction,
        programAddress: key(88) as typeof built.instruction.programAddress,
      },
    };

    await expect(
      executeWokePaymentTransaction({
        built: substituted,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toBeInstanceOf(WokeTransactionExecutionError);
    expect(rpc.requests).toHaveLength(0);
  });

  it('enforces request timeouts even when a transport ignores its abort signal', async () => {
    const built = await builtTip();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: {
          ...executionLimits(),
          overallTimeoutMs: 2_000,
          requestTimeoutMs: 100,
        },
      }),
    ).rejects.toMatchObject({
      code: 'rpc-failure',
      stage: 'identifying',
    });
  });

  it('cancels an oversized chunked RPC response before JSON parsing', async () => {
    const built = await builtTip();
    const cancel = vi.fn();
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel,
      pull(controller) {
        chunks += 1;
        controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, {
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    await expect(
      executeWokePaymentTransaction({
        built,
        feePayer: signerAddress,
        signer: signer(),
        limits: executionLimits(),
      }),
    ).rejects.toMatchObject({
      code: 'rpc-failure',
      stage: 'identifying',
    });
    expect(chunks).toBeGreaterThan(4);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

function parseRequestBody(body: BodyInit | null | undefined): RpcRequestBody {
  if (typeof body !== 'string') throw new TypeError('Expected a JSON request body.');
  const parsed: unknown = JSON.parse(body);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('method' in parsed) ||
    typeof parsed.method !== 'string' ||
    !('id' in parsed) ||
    (typeof parsed.id !== 'string' && typeof parsed.id !== 'number')
  ) {
    throw new TypeError('Malformed JSON-RPC request.');
  }
  return parsed as RpcRequestBody;
}

function readTransactionParam(body: RpcRequestBody): string {
  const transaction = body.params?.[0];
  if (typeof transaction !== 'string') {
    throw new TypeError(`${body.method} omitted its transaction bytes.`);
  }
  return transaction;
}

function readAddressParams(body: RpcRequestBody): readonly string[] {
  const addresses = body.params?.[0];
  if (!Array.isArray(addresses) || !addresses.every((value) => typeof value === 'string')) {
    throw new TypeError(`${body.method} omitted its account addresses.`);
  }
  return addresses;
}

function readSimulationAccountAddresses(body: RpcRequestBody): readonly string[] {
  const config = body.params?.[1];
  if (
    config === null ||
    typeof config !== 'object' ||
    !('accounts' in config) ||
    config.accounts === null ||
    typeof config.accounts !== 'object' ||
    !('addresses' in config.accounts) ||
    !Array.isArray(config.accounts.addresses) ||
    !config.accounts.addresses.every((value) => typeof value === 'string')
  ) {
    throw new TypeError('simulateTransaction omitted its requested account snapshots.');
  }
  return config.accounts.addresses;
}

function signatureFromWireTransaction(value: string): string {
  const bytes = getBase64Encoder().encode(value);
  return getSignatureFromTransaction(getTransactionDecoder().decode(bytes));
}

function buildSimulationAccountBalances(
  addresses: readonly string[],
  built: BuiltWokeSettlementInstruction,
  feeLamports: number,
): {
  readonly addresses: readonly string[];
  readonly preBalances: readonly number[];
  readonly postBalances: readonly number[];
} {
  const preBalances = addresses.map(() => 10_000_000);
  const deltas = addresses.map(() => 0);
  const setPreBalance = (accountAddress: string, lamports: number): void => {
    const index = addresses.indexOf(accountAddress);
    if (index < 0) throw new TypeError(`Missing simulated account ${accountAddress}.`);
    preBalances[index] = lamports;
  };
  const addDelta = (accountAddress: string, lamports: number): void => {
    const index = addresses.indexOf(accountAddress);
    if (index < 0) throw new TypeError(`Missing simulated account ${accountAddress}.`);
    deltas[index] = (deltas[index] ?? 0) + lamports;
  };

  const feePayer = addresses[0];
  const rentPayer = built.instruction.accounts[built.kind === 'woke-tip' ? 8 : 10]?.address;
  if (feePayer === undefined || rentPayer === undefined) {
    throw new TypeError('Missing fee or rent payer.');
  }
  addDelta(feePayer, -feeLamports);

  const createdAccounts = [
    built.receiptAddress,
    ...(built.kind === 'weekly-subscription' && built.priorStartedAtTimestamp === null
      ? [built.entitlementAddress]
      : []),
  ];
  for (const createdAccount of createdAccounts) {
    setPreBalance(createdAccount, 0);
    addDelta(rentPayer, -minimumRentExemptBalance);
    addDelta(createdAccount, minimumRentExemptBalance);
  }
  for (const transfer of built.plan.transfers) {
    addDelta(transfer.source, -Number(transfer.lamports));
    addDelta(transfer.destination, Number(transfer.lamports));
  }

  return {
    addresses,
    preBalances,
    postBalances: preBalances.map((balance, index) => balance + (deltas[index] ?? 0)),
  };
}

function rpcAccountSnapshot(lamports: number): Record<string, unknown> | null {
  if (lamports === 0) return null;
  return {
    data: ['', 'base64'],
    executable: false,
    lamports,
    owner: WOKENET_SYSTEM_PROGRAM_ADDRESS,
    rentEpoch: 0,
    space: 0,
  };
}

function indexedSlot(
  values: readonly number[] | undefined,
  index: number,
  fallback: number,
): number {
  return values?.[Math.min(index, values.length - 1)] ?? fallback;
}

function jsonRpcResult(id: string | number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonRpcError(id: string | number, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function isParsedType(value: Record<string, unknown>, type: string): boolean {
  return (
    value.parsed !== null &&
    typeof value.parsed === 'object' &&
    'type' in value.parsed &&
    value.parsed.type === type
  );
}

function systemAccountCreation(
  source: string,
  newAccount: string,
  space: number,
  owner: string,
): Record<string, unknown> {
  return {
    program: 'system',
    programId: WOKENET_SYSTEM_PROGRAM_ADDRESS,
    stackHeight: 2,
    parsed: {
      type: 'createAccount',
      info: {
        source,
        newAccount,
        owner,
        lamports: minimumRentExemptBalance,
        space,
      },
    },
  };
}

function encodeSettlementEvent(built: BuiltWokeSettlementInstruction): Uint8Array {
  return built.kind === 'woke-tip' ? encodeTipEvent(built) : encodeSubscriptionEvent(built);
}

function encodeTipEvent(built: BuiltWokeTipInstruction): Uint8Array {
  const allocation = built.plan.recipientAllocations[0];
  if (allocation === undefined) throw new TypeError('Tip allocation missing.');
  return new TestWriter(WOKE_TIP_SETTLED_DISCRIMINATOR)
    .u16(1)
    .address(built.configAddress)
    .address(built.paymentConfigAddress)
    .address(built.receiptAddress)
    .address(built.plan.payerIdentity)
    .address(built.plan.payerAuthority)
    .address(built.recipientIdentity)
    .address(built.recipientDestination)
    .fixed(built.receiptNonce)
    .u8(0)
    .u64(built.payerRootRotationCount)
    .u64(built.paymentPolicySequence)
    .u64(built.plan.grossLamports)
    .u16(built.plan.feeBasisPoints)
    .address(built.plan.feeDestination)
    .u64(built.plan.feeLamports)
    .u64(built.plan.distributableLamports)
    .u64(allocation.lamports)
    .i64(1_000n)
    .u64(77n)
    .finish();
}

function encodeSubscriptionEvent(built: BuiltWokeSubscriptionSettlementInstruction): Uint8Array {
  const paidAt = 1_000n;
  const entitlementFrom =
    paidAt > built.priorValidUntilTimestamp ? paidAt : built.priorValidUntilTimestamp;
  const complete = new TestWriter(SUBSCRIPTION_SETTLED_DISCRIMINATOR)
    .u16(1)
    .address(built.configAddress)
    .address(built.paymentConfigAddress)
    .address(built.offeringAddress)
    .address(built.receiptAddress)
    .address(built.entitlementAddress)
    .address(built.creatorIdentity)
    .address(built.plan.payerIdentity)
    .address(built.plan.payerAuthority)
    .fixed(built.receiptNonce)
    .u8(1)
    .u64(built.payerRootRotationCount)
    .u64(built.paymentPolicySequence)
    .u64(built.offeringStateSequence)
    .fixed(built.offeringManifestHash)
    .fixed(built.refundPolicyHash)
    .u64(built.plan.grossLamports)
    .u16(built.plan.feeBasisPoints)
    .address(built.plan.feeDestination)
    .u64(built.plan.feeLamports)
    .u64(built.plan.distributableLamports)
    .u32(built.plan.recipientAllocations.length);
  for (const recipient of built.plan.recipientAllocations) {
    complete
      .address(recipient.recipientIdentity)
      .address(recipient.destination)
      .u16(recipient.basisPoints);
  }
  complete.u32(built.plan.recipientAllocations.length);
  for (const recipient of built.plan.recipientAllocations) {
    complete.u64(recipient.lamports);
  }
  return complete
    .u64(built.priorEntitlementStateSequence + 1n)
    .u64(built.priorSettlementCount + 1n)
    .i64(entitlementFrom)
    .i64(entitlementFrom + 604_800n)
    .i64(paidAt)
    .u64(77n)
    .finish();
}

class TestWriter {
  readonly #bytes: number[];

  constructor(prefix: Uint8Array) {
    this.#bytes = [...prefix];
  }

  fixed(value: Uint8Array): this {
    this.#bytes.push(...value);
    return this;
  }

  address(value: string): this {
    return this.fixed(bs58.decode(value));
  }

  u8(value: number): this {
    this.#bytes.push(value);
    return this;
  }

  u16(value: number): this {
    this.#bytes.push(value & 0xff, (value >>> 8) & 0xff);
    return this;
  }

  u32(value: number): this {
    this.#bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
    return this;
  }

  u64(value: bigint): this {
    let remaining = value;
    for (let index = 0; index < 8; index += 1) {
      this.#bytes.push(Number(remaining & 0xffn));
      remaining >>= 8n;
    }
    return this;
  }

  i64(value: bigint): this {
    return this.u64(value < 0n ? value + (1n << 64n) : value);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}
