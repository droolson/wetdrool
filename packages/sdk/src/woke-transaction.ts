import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  assertIsSendableTransaction,
  blockhash,
  compileTransaction,
  type createSolanaRpc,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  getAddressDecoder,
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getSignatureFromTransaction,
  getTransactionEncoder,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signatureBytes,
  verifySignature,
  type AccountMeta,
  type Address,
  type Blockhash,
  type SignatureBytes,
  type Transaction,
} from '@solana/kit';
import {
  parseJsonWithBigInts,
  stringifyJsonWithBigInts,
  type RpcResponse,
} from '@solana/rpc-spec-types';

import {
  WOKENET_SYSTEM_PROGRAM_ADDRESS,
  assertWokePaymentSimulationMatches,
  createWokeNetContext,
  type BuiltWokeSettlementInstruction,
  type BuiltWokeSubscriptionSettlementInstruction,
  type BuiltWokeTipInstruction,
  type ValidatedWokeNetContext,
  type WokeInstruction,
  type WokeNativePaymentPlan,
  type WokePaymentSimulation,
  type WokeRecipientAllocation,
  type WokeRecipientSplitInput,
  type WokeSettlementEvent,
} from './woke-payments.js';

const WOKE_TIP_SETTLED_DISCRIMINATOR = Uint8Array.of(142, 81, 75, 163, 58, 30, 248, 115);
const SUBSCRIPTION_SETTLED_DISCRIMINATOR = Uint8Array.of(146, 48, 250, 127, 131, 180, 247, 174);
const TRANSACTION_SIGNATURE_BYTES = 64;
const MAX_SETTLEMENT_RECIPIENTS = 3;
const PAYMENT_RECEIPT_ACCOUNT_SPACE = 457n;
const SUBSCRIPTION_ENTITLEMENT_ACCOUNT_SPACE = 210n;
const U64_MAX = 18_446_744_073_709_551_615n;
const MAX_SIMULATION_ACCOUNT_BALANCES = 256;
const MAX_SIMULATION_ACCOUNT_QUERY_ADDRESSES = 100;
const MAX_SIMULATION_EVIDENCE_ATTEMPTS = 5;
const MAX_WOKENET_OUTER_INSTRUCTIONS = 16;
const MAX_SIMULATION_INNER_GROUPS = MAX_WOKENET_OUTER_INSTRUCTIONS;
const MAX_SIMULATION_INSTRUCTIONS = 64;
const MAX_SIMULATION_INSTRUCTION_ACCOUNTS = 256;
const MAX_SIMULATION_LOG_LINES = 1_024;
const MAX_SIMULATION_LOG_LINE_CHARACTERS = 16_384;
const MAX_SIMULATION_LOG_CHARACTERS = 1_048_576;
const MAX_SETTLEMENT_EVENT_BASE64_CHARACTERS = 4_096;
const MAX_SETTLEMENT_EVENT_BYTES = 3_072;
const MAX_RPC_REQUEST_BYTES = 1_048_576;
const MAX_RPC_RESPONSE_BYTES = 4_194_304;

const DEFAULT_LIMITS: Required<WokeTransactionExecutionLimits> = {
  maxConfirmationAttempts: 60,
  maxSendAttempts: 3,
  maxTransactionFeeLamports: 1_000_000n,
  overallTimeoutMs: 60_000,
  pollIntervalMs: 500,
  rebroadcastEveryAttempts: 5,
  requestTimeoutMs: 10_000,
};

export type WokeTransactionVersion = 'legacy' | 0;

export type WokeTransactionExecutionStage =
  | 'validating'
  | 'identifying'
  | 'fetching-blockhash'
  | 'fetching-rent'
  | 'compiling'
  | 'signing'
  | 'simulating'
  | 'broadcasting'
  | 'confirming';

export type WokeTransactionExecutionErrorCode =
  | 'aborted'
  | 'blockhash-substitution'
  | 'broadcast-mismatch'
  | 'confirmation-timeout'
  | 'fee-limit-exceeded'
  | 'insecure-endpoint'
  | 'invalid-context'
  | 'invalid-instruction'
  | 'invalid-rpc-response'
  | 'invalid-signature'
  | 'provider-mismatch'
  | 'rpc-failure'
  | 'signer-mismatch'
  | 'signer-rejected'
  | 'simulation-failed'
  | 'simulation-mismatch'
  | 'timeout'
  | 'transaction-expired'
  | 'transaction-failed';

export class WokeTransactionExecutionError extends Error {
  override readonly name = 'WokeTransactionExecutionError';

  constructor(
    readonly code: WokeTransactionExecutionErrorCode,
    readonly stage: WokeTransactionExecutionStage,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Hard operation bounds. Retrying an expired transaction is intentionally a
 * new operation because it requires a new blockhash and new signatures.
 */
export interface WokeTransactionExecutionLimits {
  readonly maxConfirmationAttempts?: number;
  readonly maxSendAttempts?: number;
  readonly maxTransactionFeeLamports?: bigint;
  readonly overallTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly rebroadcastEveryAttempts?: number;
  readonly requestTimeoutMs?: number;
}

export interface WokeTransactionSignature {
  readonly address: string;
  readonly signature: Uint8Array;
}

/**
 * The signer receives only the exact compiled message for this operation.
 * Implementations return detached signatures and cannot replace the message,
 * recent blockhash, fee payer, instruction, or transaction bytes.
 */
export interface WokeTransactionSigningRequest {
  readonly purpose: 'wokenet-transaction-v1';
  readonly context: ValidatedWokeNetContext;
  readonly version: WokeTransactionVersion;
  readonly feePayer: string;
  readonly instructionProgramAddress: string;
  readonly blockhash: string;
  readonly lastValidBlockHeight: bigint;
  readonly maxTransactionFeeLamports: bigint;
  readonly messageBytes: Uint8Array;
  readonly requiredSignerAddresses: readonly string[];
  readonly abortSignal: AbortSignal;
}

export type WokeTransactionSigner = (
  request: WokeTransactionSigningRequest,
) => readonly WokeTransactionSignature[] | Promise<readonly WokeTransactionSignature[]>;

export interface WokeTransactionSimulationSnapshot {
  readonly source: 'simulateTransaction';
  readonly endpoint: string;
  readonly genesisHash: string;
  readonly programAddress: string;
  readonly contextSlot: bigint;
  readonly transactionSignature: string;
  readonly transactionVersion: WokeTransactionVersion;
  readonly feePayer: string;
  readonly blockhash: string;
  readonly lastValidBlockHeight: bigint;
  readonly maxTransactionFeeLamports: bigint;
  readonly wireTransactionBase64: string;
  readonly error: null;
  readonly feeLamports: bigint;
  readonly logs: readonly string[] | null;
  readonly innerInstructions: unknown;
  readonly accountBalances: readonly WokeTransactionSimulationAccountBalance[];
  readonly unitsConsumed: bigint | null;
  readonly minimumRentExemptBalances: Readonly<Record<string, bigint>>;
}

export interface WokeTransactionSimulationAccountBalance {
  readonly address: string;
  readonly preLamports: bigint;
  readonly postLamports: bigint;
  readonly deltaLamports: bigint;
}

export type WokeTransactionSimulationVerifier = (
  simulation: WokeTransactionSimulationSnapshot,
) => void | Promise<void>;

interface ExecuteWokeInstructionBase {
  readonly context: ValidatedWokeNetContext;
  readonly feePayer: string;
  readonly signer: WokeTransactionSigner;
  readonly verifySimulation: WokeTransactionSimulationVerifier;
  readonly rentExemptionSpaces?: readonly number[];
  readonly version?: WokeTransactionVersion;
  readonly limits?: WokeTransactionExecutionLimits;
  readonly abortSignal?: AbortSignal;
}

export interface ExecuteWokeInstructionInput extends ExecuteWokeInstructionBase {
  readonly instruction: WokeInstruction;
}

export interface ExecuteWokeInstructionsInput extends ExecuteWokeInstructionBase {
  readonly instructions: readonly WokeInstruction[];
}

export interface ExecuteWokePaymentTransactionInput {
  readonly built: BuiltWokeSettlementInstruction;
  readonly feePayer: string;
  readonly signer: WokeTransactionSigner;
  readonly version?: WokeTransactionVersion;
  readonly limits?: WokeTransactionExecutionLimits;
  readonly abortSignal?: AbortSignal;
}

export interface WokeTransactionExecutionResult {
  readonly context: ValidatedWokeNetContext;
  readonly signature: string;
  readonly slot: bigint;
  readonly finalized: true;
  readonly version: WokeTransactionVersion;
  readonly feePayer: string;
  readonly blockhash: string;
  readonly lastValidBlockHeight: bigint;
  readonly simulationSlot: bigint;
  readonly simulatedFeeLamports: bigint;
  /**
   * Exact simulation-bound minimum rent-exempt balances keyed by account data
   * size in bytes. The result owns an immutable defensive copy.
   */
  readonly minimumRentExemptBalances: Readonly<Record<string, bigint>>;
  readonly unitsConsumed: bigint | null;
  readonly wireTransactionBase64: string;
  readonly wireTransactionByteLength: number;
  readonly sendAttempts: number;
  readonly confirmationAttempts: number;
}

interface LatestBlockhash {
  readonly blockhash: Blockhash;
  readonly lastValidBlockHeight: bigint;
  readonly contextSlot: bigint;
}

interface ValidatedSimulation {
  readonly snapshot: WokeTransactionSimulationSnapshot;
  readonly contextSlot: bigint;
  readonly feeLamports: bigint;
  readonly unitsConsumed: bigint | null;
}

interface OperationScope {
  readonly signal: AbortSignal;
  readonly requestTimeoutMs: number;
  assertActive(stage: WokeTransactionExecutionStage): void;
  error(stage: WokeTransactionExecutionStage): WokeTransactionExecutionError;
  dispose(): void;
}

interface SendAttemptState {
  attempts: number;
  lastError: Error | undefined;
}

interface ValidatedSignatureStatus {
  readonly slot: bigint;
  readonly confirmationStatus: 'processed' | 'confirmed' | 'finalized';
  readonly err: unknown;
}

interface ObservedSystemAccountCreation {
  readonly source: string;
  readonly newAccount: string;
  readonly owner: string;
  readonly lamports: bigint;
  readonly space: bigint;
}

interface DecodedSystemEffects {
  readonly transfers: WokePaymentSimulation['transfers'];
  readonly accountCreations: readonly ObservedSystemAccountCreation[];
}

type WokeRpcTransport = Parameters<typeof createSolanaRpcFromTransport>[0];

/**
 * Kit's default HTTP transport materializes the entire provider response
 * before parsing it. Transaction execution instead streams through a hard
 * decompressed-byte ceiling and forbids redirects before bigint-aware parsing.
 */
function createBoundedWokeRpc(endpoint: string): ReturnType<typeof createSolanaRpc> {
  const transport: WokeRpcTransport = async function boundedWokeRpcTransport<TResponse>({
    payload,
    signal,
  }: Parameters<WokeRpcTransport>[0]): Promise<RpcResponse<TResponse>> {
    let requestBody: string;
    try {
      requestBody = stringifyJsonWithBigInts(payload);
    } catch (error) {
      throw new Error('The Solana RPC request could not be serialized.', { cause: error });
    }
    if (new TextEncoder().encode(requestBody).byteLength > MAX_RPC_REQUEST_BYTES) {
      throw new Error('The Solana RPC request exceeded its byte budget.');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json; charset=utf-8',
      },
      body: requestBody,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) {
      await cancelRpcResponseBody(response.body);
      throw new Error(`The Solana RPC endpoint returned HTTP ${String(response.status)}.`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      await cancelRpcResponseBody(response.body);
      throw new Error('The Solana RPC endpoint did not return application/json.');
    }
    await assertBoundedRpcContentLength(response);
    const responseText = await readBoundedRpcResponseText(response);
    try {
      return parseJsonWithBigInts(responseText) as RpcResponse<TResponse>;
    } catch (error) {
      throw new Error('The Solana RPC endpoint returned invalid bounded JSON.', {
        cause: error,
      });
    }
  };
  return createSolanaRpcFromTransport(transport) as ReturnType<typeof createSolanaRpc>;
}

async function assertBoundedRpcContentLength(response: Response): Promise<void> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength === null) return;
  const normalizedLength = declaredLength.trim();
  if (!/^\d+$/u.test(normalizedLength)) {
    await cancelRpcResponseBody(response.body);
    throw new Error('The Solana RPC endpoint returned an invalid Content-Length header.');
  }
  const canonicalLength = normalizedLength.replace(/^0+/u, '') || '0';
  const maximumLength = String(MAX_RPC_RESPONSE_BYTES);
  if (
    canonicalLength.length > maximumLength.length ||
    (canonicalLength.length === maximumLength.length && canonicalLength > maximumLength)
  ) {
    await cancelRpcResponseBody(response.body);
    throw new Error('The Solana RPC response exceeded its byte budget.');
  }
}

async function readBoundedRpcResponseText(response: Response): Promise<string> {
  if (response.body === null) {
    throw new Error('The Solana RPC endpoint returned an empty response.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > MAX_RPC_RESPONSE_BYTES) {
        await cancelRpcResponseReader(reader);
        throw new Error('The Solana RPC response exceeded its byte budget.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error('The Solana RPC endpoint returned invalid UTF-8.', { cause: error });
  }
}

async function cancelRpcResponseBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // Cancellation is best effort after the response has already been rejected.
  }
}

async function cancelRpcResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Cancellation is best effort after the response has already been rejected.
  }
}

/**
 * Compiles, signs, simulates, broadcasts, and finalizes one WokeSocial program
 * instruction against the exact endpoint/genesis/program tuple in `context`.
 *
 * `verifySimulation` is mandatory: generic instructions do not have a safe
 * universal effects predicate. Legacy tip and subscription callers should use
 * {@link executeWokePaymentTransaction}, which supplies the protocol-specific
 * verifier.
 */
export async function executeWokeInstruction(
  input: ExecuteWokeInstructionInput,
): Promise<WokeTransactionExecutionResult> {
  const { instruction, ...shared } = input;
  return executeWokeInstructions({ ...shared, instructions: [instruction] });
}

/**
 * Executes one atomic transaction containing a bounded ordered list of
 * instructions for the same context-bound WokeSocial program. Solana commits
 * all of them or none of them.
 */
export async function executeWokeInstructions(
  input: ExecuteWokeInstructionsInput,
): Promise<WokeTransactionExecutionResult> {
  const limits = parseLimits(input.limits);
  const scope = createOperationScope(input.abortSignal, limits);
  try {
    scope.assertActive('validating');
    const context = parseExecutionContext(input.context);
    const instructions = snapshotInstructions(context, input.instructions);
    const feePayer = parseExecutionAddress(input.feePayer, 'transaction fee payer');
    const version = parseTransactionVersion(input.version);
    const rentExemptionSpaces = parseRentExemptionSpaces(input.rentExemptionSpaces);
    if (typeof input.signer !== 'function') {
      throw executionError(
        'signer-mismatch',
        'validating',
        'A per-operation WokeNet transaction signer is required.',
      );
    }
    if (typeof input.verifySimulation !== 'function') {
      throw executionError(
        'simulation-mismatch',
        'validating',
        'An instruction-specific simulation verifier is required.',
      );
    }

    const rpc = createBoundedWokeRpc(context.endpoint);
    await assertProviderIdentity(rpc, context, scope, 'identifying');
    const latestBlockhash = await fetchLatestBlockhash(rpc, scope);
    const minimumRentExemptBalances = await fetchMinimumRentExemptBalances(
      rpc,
      rentExemptionSpaces,
      scope,
    );

    scope.assertActive('compiling');
    const transaction = compileWokeTransaction(instructions, feePayer, version, latestBlockhash);
    const writableTransactionAccountAddresses =
      decodeWritableTransactionAccountAddresses(transaction);
    const signedTransaction = await collectAndVerifySignatures(
      transaction,
      {
        context,
        feePayer,
        instructionProgramAddress: context.programAddress,
        version,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        maxTransactionFeeLamports: limits.maxTransactionFeeLamports,
      },
      input.signer,
      scope,
    );
    assertIsSendableTransaction(signedTransaction);

    const wireTransactionBytes = Uint8Array.from(getTransactionEncoder().encode(signedTransaction));
    const wireTransactionBase64 = getBase64Decoder().decode(wireTransactionBytes);
    const decodedWireBytes = getBase64Encoder().encode(wireTransactionBase64);
    const messageBytes = Uint8Array.from(signedTransaction.messageBytes);
    const messageBase64 = getBase64Decoder().decode(messageBytes);
    const decodedMessageBytes = getBase64Encoder().encode(messageBase64);
    if (
      !equalBytes(Uint8Array.from(decodedWireBytes), wireTransactionBytes) ||
      !equalBytes(Uint8Array.from(decodedMessageBytes), messageBytes)
    ) {
      throw executionError(
        'invalid-instruction',
        'compiling',
        'Solana transaction or message base64 encoding did not round-trip to the exact signed bytes.',
      );
    }
    const transactionSignature = getSignatureFromTransaction(signedTransaction);

    // Re-check the provider after signing. A long-running external signer must
    // not let an endpoint silently switch networks underneath the operation.
    await assertProviderIdentity(rpc, context, scope, 'identifying');
    const simulation = await simulateExactTransaction(
      rpc,
      context,
      {
        feePayer,
        version,
        latestBlockhash,
        transactionSignature,
        messageBase64,
        wireTransactionBase64,
        writableTransactionAccountAddresses,
        maxTransactionFeeLamports: limits.maxTransactionFeeLamports,
        minimumRentExemptBalances,
      },
      scope,
    );
    try {
      await awaitWithAbort(
        Promise.resolve(input.verifySimulation(simulation.snapshot)),
        scope,
        'simulating',
      );
    } catch (error) {
      if (error instanceof WokeTransactionExecutionError) {
        throw error;
      }
      throw executionError(
        'simulation-mismatch',
        'simulating',
        'The simulated effects do not match the approved WokeNet operation.',
        error,
      );
    }

    // Verify the same endpoint is still on the expected genesis immediately
    // before sending the already-simulated bytes.
    await assertProviderIdentity(rpc, context, scope, 'identifying');
    const currentBlockHeight = await fetchBlockHeight(
      rpc,
      latestBlockhash.contextSlot,
      scope,
      'broadcasting',
    );
    if (currentBlockHeight > latestBlockhash.lastValidBlockHeight) {
      throw executionError(
        'transaction-expired',
        'broadcasting',
        'The signed WokeNet transaction blockhash expired before broadcast.',
      );
    }

    const sendState: SendAttemptState = { attempts: 0, lastError: undefined };
    await broadcastExactTransaction(
      rpc,
      wireTransactionBase64,
      transactionSignature,
      latestBlockhash.contextSlot,
      sendState,
      limits,
      scope,
    );

    const confirmation = await waitForFinalization({
      rpc,
      context,
      transactionSignature,
      wireTransactionBase64,
      latestBlockhash,
      sendState,
      limits,
      scope,
    });

    return Object.freeze({
      context,
      signature: transactionSignature,
      slot: confirmation.slot,
      finalized: true,
      version,
      feePayer,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      simulationSlot: simulation.contextSlot,
      simulatedFeeLamports: simulation.feeLamports,
      minimumRentExemptBalances: Object.freeze({
        ...simulation.snapshot.minimumRentExemptBalances,
      }),
      unitsConsumed: simulation.unitsConsumed,
      wireTransactionBase64,
      wireTransactionByteLength: wireTransactionBytes.byteLength,
      sendAttempts: sendState.attempts,
      confirmationAttempts: confirmation.attempts,
    });
  } finally {
    scope.dispose();
  }
}

/**
 * Executes a built legacy SOL tip or weekly-subscription settlement. The SDK decodes
 * every parsed System Program transfer and the Anchor settlement event from
 * the exact simulation response, then applies
 * `assertWokePaymentSimulationMatches` before any bytes are broadcast.
 */
export async function executeWokePaymentTransaction(
  input: ExecuteWokePaymentTransactionInput,
): Promise<WokeTransactionExecutionResult> {
  const built = snapshotBuiltSettlement(input.built);
  return executeWokeInstruction({
    context: built.context,
    instruction: built.instruction,
    feePayer: input.feePayer,
    signer: input.signer,
    verifySimulation: (snapshot) => {
      const { simulation, accountCreations } = decodeWokePaymentSimulationWithEffects(snapshot);
      assertWokePaymentSimulationMatches(built, simulation);
      assertExpectedAccountCreations(built, accountCreations, snapshot.minimumRentExemptBalances);
      assertExactPaymentLamportEffects(snapshot, simulation.transfers, accountCreations);
    },
    rentExemptionSpaces:
      built.kind === 'weekly-subscription'
        ? [PAYMENT_RECEIPT_ACCOUNT_SPACE, SUBSCRIPTION_ENTITLEMENT_ACCOUNT_SPACE].map(Number)
        : [Number(PAYMENT_RECEIPT_ACCOUNT_SPACE)],
    ...(input.version === undefined ? {} : { version: input.version }),
    ...(input.limits === undefined ? {} : { limits: input.limits }),
    ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
  });
}

/**
 * Decodes the protocol effects needed by the existing legacy payment verifier.
 * It fails closed if a System Program inner instruction is not parsed, since
 * an opaque instruction could otherwise conceal an extra transfer.
 */
export function decodeWokePaymentSimulation(
  snapshot: WokeTransactionSimulationSnapshot,
): WokePaymentSimulation {
  return decodeWokePaymentSimulationWithEffects(snapshot).simulation;
}

function decodeWokePaymentSimulationWithEffects(snapshot: WokeTransactionSimulationSnapshot): {
  readonly simulation: WokePaymentSimulation;
  readonly accountCreations: readonly ObservedSystemAccountCreation[];
} {
  const context = createWokeNetContext({
    endpoint: snapshot.endpoint,
    genesisHash: snapshot.genesisHash,
    programAddress: snapshot.programAddress,
  });
  const { transfers, accountCreations } = decodeSystemEffects(snapshot.innerInstructions);
  const events = decodeSettlementEvents(snapshot.logs, context.programAddress);
  return {
    simulation: {
      source: 'simulateTransaction',
      endpoint: context.endpoint,
      genesisHash: context.genesisHash,
      programAddress: context.programAddress,
      error: snapshot.error,
      transfers,
      events,
    },
    accountCreations,
  };
}

function parseExecutionContext(input: ValidatedWokeNetContext): ValidatedWokeNetContext {
  let context: ValidatedWokeNetContext;
  try {
    context = createWokeNetContext(input);
  } catch (error) {
    throw executionError(
      'invalid-context',
      'validating',
      'The WokeNet execution context is invalid.',
      error,
    );
  }
  const endpoint = new URL(context.endpoint);
  if (
    endpoint.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
  ) {
    throw executionError(
      'insecure-endpoint',
      'validating',
      'Remote Solana transaction execution requires an HTTPS RPC endpoint.',
    );
  }
  return context;
}

function parseExecutionAddress(value: string, label: string): Address {
  try {
    const parsed = address(value);
    if (parsed === WOKENET_SYSTEM_PROGRAM_ADDRESS) {
      throw new TypeError('default address');
    }
    return parsed;
  } catch (error) {
    throw executionError(
      'invalid-instruction',
      'validating',
      `The ${label} must be a non-default Solana address.`,
      error,
    );
  }
}

function parseTransactionVersion(
  value: WokeTransactionVersion | undefined,
): WokeTransactionVersion {
  if (value === undefined || value === 0) return 0;
  if (value === 'legacy') return value;
  throw executionError(
    'invalid-instruction',
    'validating',
    'WokeNet transaction version must be legacy or version 0.',
  );
}

function snapshotInstruction(
  context: ValidatedWokeNetContext,
  candidate: WokeInstruction,
): WokeInstruction {
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    candidate.programAddress !== context.programAddress ||
    !Array.isArray(candidate.accounts) ||
    !(candidate.data instanceof Uint8Array) ||
    candidate.data.byteLength === 0
  ) {
    throw executionError(
      'invalid-instruction',
      'validating',
      'The instruction must be a non-empty instruction for the context-bound WokeSocial program.',
    );
  }
  const accounts: AccountMeta[] = candidate.accounts.map((candidateMeta, index) => {
    if (
      candidateMeta === null ||
      typeof candidateMeta !== 'object' ||
      !Number.isInteger(candidateMeta.role) ||
      candidateMeta.role < AccountRole.READONLY ||
      candidateMeta.role > AccountRole.WRITABLE_SIGNER
    ) {
      throw executionError(
        'invalid-instruction',
        'validating',
        `Instruction account ${String(index)} has an invalid role.`,
      );
    }
    try {
      return {
        address: address(candidateMeta.address),
        role: candidateMeta.role,
      };
    } catch (error) {
      throw executionError(
        'invalid-instruction',
        'validating',
        `Instruction account ${String(index)} has an invalid address.`,
        error,
      );
    }
  });
  return Object.freeze({
    programAddress: address(context.programAddress),
    accounts: Object.freeze(accounts),
    data: Uint8Array.from(candidate.data),
  });
}

function snapshotInstructions(
  context: ValidatedWokeNetContext,
  candidates: readonly WokeInstruction[],
): readonly WokeInstruction[] {
  if (
    !Array.isArray(candidates) ||
    candidates.length === 0 ||
    candidates.length > MAX_WOKENET_OUTER_INSTRUCTIONS
  ) {
    throw executionError(
      'invalid-instruction',
      'validating',
      `A WokeNet transaction must contain 1–${String(MAX_WOKENET_OUTER_INSTRUCTIONS)} instructions.`,
    );
  }
  return Object.freeze(candidates.map((candidate) => snapshotInstruction(context, candidate)));
}

function compileWokeTransaction(
  instructions: readonly WokeInstruction[],
  feePayer: Address,
  version: WokeTransactionVersion,
  latestBlockhash: LatestBlockhash,
): Readonly<Transaction> {
  try {
    const message = appendTransactionMessageInstructions(
      instructions,
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        setTransactionMessageFeePayer(feePayer, createTransactionMessage({ version })),
      ),
    );
    return compileTransaction(message);
  } catch (error) {
    throw executionError(
      'invalid-instruction',
      'compiling',
      'The WokeSocial instructions could not be compiled into a Solana transaction.',
      error,
    );
  }
}

function decodeWritableTransactionAccountAddresses(
  transaction: Readonly<Transaction>,
): readonly string[] {
  try {
    const decoded = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    const accountCount = decoded.staticAccounts.length;
    const { numReadonlyNonSignerAccounts, numReadonlySignerAccounts, numSignerAccounts } =
      decoded.header;
    if (
      accountCount < 1 ||
      accountCount > MAX_SIMULATION_ACCOUNT_BALANCES ||
      new Set(decoded.staticAccounts).size !== accountCount ||
      !Number.isSafeInteger(numSignerAccounts) ||
      !Number.isSafeInteger(numReadonlySignerAccounts) ||
      !Number.isSafeInteger(numReadonlyNonSignerAccounts) ||
      numSignerAccounts < 1 ||
      numSignerAccounts > accountCount ||
      numReadonlySignerAccounts < 0 ||
      numReadonlySignerAccounts > numSignerAccounts ||
      numReadonlyNonSignerAccounts < 0 ||
      numReadonlyNonSignerAccounts > accountCount - numSignerAccounts ||
      ('addressTableLookups' in decoded &&
        decoded.addressTableLookups !== undefined &&
        decoded.addressTableLookups.length !== 0)
    ) {
      throw new TypeError('invalid static account set');
    }

    const writableSignerCount = numSignerAccounts - numReadonlySignerAccounts;
    const writableNonSignerEnd = accountCount - numReadonlyNonSignerAccounts;
    const writableAccounts = decoded.staticAccounts.filter(
      (_accountAddress, index) =>
        index < writableSignerCount || (index >= numSignerAccounts && index < writableNonSignerEnd),
    );
    if (
      writableAccounts.length < 1 ||
      writableAccounts.length > MAX_SIMULATION_ACCOUNT_QUERY_ADDRESSES ||
      writableAccounts[0] !== decoded.staticAccounts[0]
    ) {
      throw new TypeError('invalid writable account set');
    }
    return Object.freeze([...writableAccounts]);
  } catch (error) {
    throw executionError(
      'invalid-instruction',
      'compiling',
      'The compiled transaction writable-account set is invalid.',
      error,
    );
  }
}

async function collectAndVerifySignatures(
  transaction: Readonly<Transaction>,
  binding: {
    readonly context: ValidatedWokeNetContext;
    readonly feePayer: string;
    readonly instructionProgramAddress: string;
    readonly version: WokeTransactionVersion;
    readonly blockhash: string;
    readonly lastValidBlockHeight: bigint;
    readonly maxTransactionFeeLamports: bigint;
  },
  signer: WokeTransactionSigner,
  scope: OperationScope,
): Promise<Transaction> {
  scope.assertActive('signing');
  const messageBytes = Uint8Array.from(transaction.messageBytes);
  const requiredSignerAddresses = Object.freeze(Object.keys(transaction.signatures));
  if (
    requiredSignerAddresses.length === 0 ||
    requiredSignerAddresses[0] !== binding.feePayer ||
    new Set(requiredSignerAddresses).size !== requiredSignerAddresses.length
  ) {
    throw executionError(
      'invalid-instruction',
      'compiling',
      'The compiled transaction signer set is invalid or does not begin with the fee payer.',
    );
  }

  let returned: readonly WokeTransactionSignature[];
  try {
    returned = await awaitWithAbort(
      Promise.resolve(
        signer({
          purpose: 'wokenet-transaction-v1',
          context: Object.freeze({ ...binding.context }),
          version: binding.version,
          feePayer: binding.feePayer,
          instructionProgramAddress: binding.instructionProgramAddress,
          blockhash: binding.blockhash,
          lastValidBlockHeight: binding.lastValidBlockHeight,
          maxTransactionFeeLamports: binding.maxTransactionFeeLamports,
          messageBytes: Uint8Array.from(messageBytes),
          requiredSignerAddresses,
          abortSignal: scope.signal,
        }),
      ),
      scope,
      'signing',
    );
  } catch (error) {
    if (error instanceof WokeTransactionExecutionError) throw error;
    throw executionError(
      'signer-rejected',
      'signing',
      'The operation-scoped signer rejected the WokeNet transaction.',
      error,
    );
  }

  if (!Array.isArray(returned) || returned.length !== requiredSignerAddresses.length) {
    throw executionError(
      'signer-mismatch',
      'signing',
      'The signer must return exactly one signature for every required address.',
    );
  }

  const expected = new Set(requiredSignerAddresses);
  const signatures = new Map<string, SignatureBytes>();
  for (const [index, candidate] of returned.entries()) {
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      typeof candidate.address !== 'string' ||
      !(candidate.signature instanceof Uint8Array)
    ) {
      throw executionError(
        'signer-mismatch',
        'signing',
        `Signer result ${String(index)} is malformed.`,
      );
    }
    let signerAddress: Address;
    try {
      signerAddress = address(candidate.address);
    } catch (error) {
      throw executionError(
        'signer-mismatch',
        'signing',
        `Signer result ${String(index)} has an invalid address.`,
        error,
      );
    }
    if (!expected.has(signerAddress) || signatures.has(signerAddress)) {
      throw executionError(
        'signer-mismatch',
        'signing',
        'The signer returned an unexpected or duplicate signer address.',
      );
    }
    if (candidate.signature.byteLength !== TRANSACTION_SIGNATURE_BYTES) {
      throw executionError(
        'invalid-signature',
        'signing',
        `The signature for ${signerAddress} is not a 64-byte Ed25519 signature.`,
      );
    }
    const detachedSignature = signatureBytes(Uint8Array.from(candidate.signature));
    let valid = false;
    try {
      const publicKey = await getPublicKeyFromAddress(signerAddress);
      valid = await verifySignature(publicKey, detachedSignature, messageBytes);
    } catch (error) {
      throw executionError(
        'invalid-signature',
        'signing',
        `The signature for ${signerAddress} could not be verified.`,
        error,
      );
    }
    if (!valid) {
      throw executionError(
        'invalid-signature',
        'signing',
        `The signer did not sign the exact compiled message for ${signerAddress}.`,
      );
    }
    signatures.set(signerAddress, detachedSignature);
  }

  if (!equalBytes(Uint8Array.from(transaction.messageBytes), messageBytes)) {
    throw executionError(
      'signer-mismatch',
      'signing',
      'The compiled transaction message changed while signatures were collected.',
    );
  }
  const orderedSignatures: Record<string, SignatureBytes> = {};
  for (const signerAddress of requiredSignerAddresses) {
    const detachedSignature = signatures.get(signerAddress);
    if (detachedSignature === undefined) {
      throw executionError(
        'signer-mismatch',
        'signing',
        `The signer omitted required address ${signerAddress}.`,
      );
    }
    orderedSignatures[signerAddress] = detachedSignature;
  }
  return Object.freeze({
    ...transaction,
    messageBytes: transaction.messageBytes,
    signatures: Object.freeze(orderedSignatures),
  });
}

async function assertProviderIdentity(
  rpc: ReturnType<typeof createSolanaRpc>,
  context: ValidatedWokeNetContext,
  scope: OperationScope,
  stage: WokeTransactionExecutionStage,
): Promise<void> {
  const observed = await sendRpcRequest(rpc.getGenesisHash(), scope, stage, 'getGenesisHash');
  if (typeof observed !== 'string') {
    throw executionError(
      'invalid-rpc-response',
      stage,
      'The WokeNet provider returned a malformed genesis hash.',
    );
  }
  if (observed !== context.genesisHash) {
    throw executionError(
      'provider-mismatch',
      stage,
      'The RPC provider genesis hash does not match the approved WokeNet Solana deployment.',
    );
  }
}

async function fetchLatestBlockhash(
  rpc: ReturnType<typeof createSolanaRpc>,
  scope: OperationScope,
): Promise<LatestBlockhash> {
  const response = await sendRpcRequest(
    rpc.getLatestBlockhash({ commitment: 'confirmed' }),
    scope,
    'fetching-blockhash',
    'getLatestBlockhash',
  );
  if (
    response === null ||
    typeof response !== 'object' ||
    response.context === null ||
    typeof response.context !== 'object' ||
    response.value === null ||
    typeof response.value !== 'object' ||
    typeof response.context.slot !== 'bigint' ||
    typeof response.value.blockhash !== 'string' ||
    typeof response.value.lastValidBlockHeight !== 'bigint' ||
    response.context.slot < 0n ||
    response.value.lastValidBlockHeight < 0n
  ) {
    throw executionError(
      'invalid-rpc-response',
      'fetching-blockhash',
      'The WokeNet provider returned a malformed latest blockhash response.',
    );
  }
  let parsedBlockhash: Blockhash;
  try {
    parsedBlockhash = blockhash(response.value.blockhash);
  } catch (error) {
    throw executionError(
      'invalid-rpc-response',
      'fetching-blockhash',
      'The WokeNet provider returned an invalid recent blockhash.',
      error,
    );
  }
  return {
    blockhash: parsedBlockhash,
    lastValidBlockHeight: response.value.lastValidBlockHeight,
    contextSlot: response.context.slot,
  };
}

async function fetchMinimumRentExemptBalances(
  rpc: ReturnType<typeof createSolanaRpc>,
  spaces: readonly number[],
  scope: OperationScope,
): Promise<Readonly<Record<string, bigint>>> {
  const balances: Record<string, bigint> = {};
  for (const space of spaces) {
    const value = await sendRpcRequest(
      rpc.getMinimumBalanceForRentExemption(BigInt(space), {
        commitment: 'confirmed',
      }),
      scope,
      'fetching-rent',
      'getMinimumBalanceForRentExemption',
    );
    const balance = parseNonnegativeRpcBigint(
      value,
      `minimum rent-exempt balance for ${String(space)} bytes`,
      'fetching-rent',
    );
    if (balance === 0n) {
      throw executionError(
        'invalid-rpc-response',
        'fetching-rent',
        'The provider returned a zero minimum rent-exempt balance.',
      );
    }
    balances[String(space)] = balance;
  }
  return Object.freeze(balances);
}

async function simulateExactTransaction(
  rpc: ReturnType<typeof createSolanaRpc>,
  context: ValidatedWokeNetContext,
  binding: {
    readonly feePayer: string;
    readonly version: WokeTransactionVersion;
    readonly latestBlockhash: LatestBlockhash;
    readonly transactionSignature: string;
    readonly messageBase64: string;
    readonly wireTransactionBase64: string;
    readonly writableTransactionAccountAddresses: readonly string[];
    readonly maxTransactionFeeLamports: bigint;
    readonly minimumRentExemptBalances: Readonly<Record<string, bigint>>;
  },
  scope: OperationScope,
): Promise<ValidatedSimulation> {
  const writableAccountAddresses = binding.writableTransactionAccountAddresses.map(
    (accountAddress) => address(accountAddress),
  );
  let minimumEvidenceSlot = binding.latestBlockhash.contextSlot;

  for (let attempt = 1; attempt <= MAX_SIMULATION_EVIDENCE_ATTEMPTS; attempt += 1) {
    const preAccountResponse = await sendRpcRequest(
      rpc.getMultipleAccounts(writableAccountAddresses, {
        commitment: 'confirmed',
        encoding: 'base64',
        dataSlice: { length: 0, offset: 0 },
        minContextSlot: minimumEvidenceSlot,
      }),
      scope,
      'simulating',
      'getMultipleAccounts',
    );
    const preAccountContextSlot = parseSimulationContextSlot(
      preAccountResponse,
      minimumEvidenceSlot,
      'pre-simulation account',
    );
    if (!Array.isArray(preAccountResponse.value)) {
      throw executionError(
        'invalid-rpc-response',
        'simulating',
        'The WokeNet provider returned a malformed pre-simulation account response.',
      );
    }
    const preLamports = parseSimulationRpcAccountLamports(
      preAccountResponse.value,
      writableAccountAddresses,
      'pre-simulation',
    );

    const feeResponse = await sendRpcRequest(
      rpc.getFeeForMessage(
        binding.messageBase64 as Parameters<
          ReturnType<typeof createSolanaRpc>['getFeeForMessage']
        >[0],
        {
          commitment: 'confirmed',
          minContextSlot: preAccountContextSlot,
        },
      ),
      scope,
      'simulating',
      'getFeeForMessage',
    );
    const feeContextSlot = parseSimulationContextSlot(
      feeResponse,
      preAccountContextSlot,
      'transaction-fee',
    );
    const feeLamports = parseRpcLamports(feeResponse.value, 'exact-message transaction fee');
    if (feeContextSlot !== preAccountContextSlot) {
      minimumEvidenceSlot = feeContextSlot;
      continue;
    }
    if (feeLamports > binding.maxTransactionFeeLamports) {
      throw executionError(
        'fee-limit-exceeded',
        'simulating',
        `The exact-message WokeNet transaction fee exceeds the approved ${String(
          binding.maxTransactionFeeLamports,
        )}-lamport limit.`,
      );
    }

    const response = await sendRpcRequest(
      rpc.simulateTransaction(
        binding.wireTransactionBase64 as Parameters<
          ReturnType<typeof createSolanaRpc>['simulateTransaction']
        >[0],
        {
          accounts: {
            addresses: writableAccountAddresses,
            encoding: 'base64',
          },
          commitment: 'confirmed',
          encoding: 'base64',
          innerInstructions: true,
          minContextSlot: preAccountContextSlot,
          replaceRecentBlockhash: false,
          sigVerify: true,
        },
      ),
      scope,
      'simulating',
      'simulateTransaction',
    );
    const simulationContextSlot = parseSimulationContextSlot(
      response,
      preAccountContextSlot,
      'simulation',
    );
    if (!isRecord(response.value)) {
      throw executionError(
        'invalid-rpc-response',
        'simulating',
        'The WokeNet provider returned a malformed simulation response.',
      );
    }
    if (simulationContextSlot !== preAccountContextSlot) {
      minimumEvidenceSlot = simulationContextSlot;
      continue;
    }
    if (
      !Object.hasOwn(response.value, 'replacementBlockhash') ||
      response.value.replacementBlockhash !== null
    ) {
      throw executionError(
        'blockhash-substitution',
        'simulating',
        'The provider replaced or failed to attest the signed transaction blockhash during simulation.',
      );
    }
    if (!Object.hasOwn(response.value, 'err')) {
      throw executionError(
        'invalid-rpc-response',
        'simulating',
        'The simulation response omitted its execution result.',
      );
    }
    if (response.value.err !== null) {
      throw executionError(
        'simulation-failed',
        'simulating',
        'The exact signed WokeNet transaction failed simulation.',
      );
    }
    const logs = parseSimulationLogs(response.value.logs);
    const innerInstructions = parseBoundedInnerInstructions(response.value.innerInstructions);
    const postLamports = parseSimulationRpcAccountLamports(
      response.value.accounts,
      writableAccountAddresses,
      'post-simulation',
    );
    const accountBalances = parseSimulationAccountBalances(
      preLamports,
      postLamports,
      writableAccountAddresses,
    );
    const unitsConsumed =
      response.value.unitsConsumed === undefined
        ? null
        : parseNonnegativeRpcBigint(
            response.value.unitsConsumed,
            'simulation compute-unit count',
            'simulating',
          );
    const snapshot: WokeTransactionSimulationSnapshot = Object.freeze({
      source: 'simulateTransaction',
      endpoint: context.endpoint,
      genesisHash: context.genesisHash,
      programAddress: context.programAddress,
      contextSlot: simulationContextSlot,
      transactionSignature: binding.transactionSignature,
      transactionVersion: binding.version,
      feePayer: binding.feePayer,
      blockhash: binding.latestBlockhash.blockhash,
      lastValidBlockHeight: binding.latestBlockhash.lastValidBlockHeight,
      maxTransactionFeeLamports: binding.maxTransactionFeeLamports,
      wireTransactionBase64: binding.wireTransactionBase64,
      error: null,
      feeLamports,
      logs,
      innerInstructions,
      accountBalances,
      unitsConsumed,
      minimumRentExemptBalances: binding.minimumRentExemptBalances,
    });
    return {
      snapshot,
      contextSlot: simulationContextSlot,
      feeLamports,
      unitsConsumed,
    };
  }

  throw executionError(
    'simulation-mismatch',
    'simulating',
    `The provider could not return fee, pre-account, and post-simulation evidence from one confirmed slot within ${String(
      MAX_SIMULATION_EVIDENCE_ATTEMPTS,
    )} attempts.`,
  );
}

function parseSimulationContextSlot(response: unknown, minimumSlot: bigint, label: string): bigint {
  if (
    !isRecord(response) ||
    !isRecord(response.context) ||
    typeof response.context.slot !== 'bigint' ||
    response.context.slot < minimumSlot ||
    response.context.slot > U64_MAX ||
    !Object.hasOwn(response, 'value')
  ) {
    throw executionError(
      'invalid-rpc-response',
      'simulating',
      `The WokeNet provider returned a malformed or stale ${label} response.`,
    );
  }
  return response.context.slot;
}

function parseSimulationRpcAccountLamports(
  value: unknown,
  accountAddresses: readonly string[],
  label: string,
): readonly bigint[] {
  if (
    !Array.isArray(value) ||
    value.length !== accountAddresses.length ||
    value.length > MAX_SIMULATION_ACCOUNT_QUERY_ADDRESSES
  ) {
    throw executionError(
      'invalid-rpc-response',
      'simulating',
      `The ${label} account response does not match the exact writable-account request.`,
    );
  }
  return Object.freeze(
    value.map((account, index) => {
      if (account === null) return 0n;
      if (!isRecord(account) || !Object.hasOwn(account, 'lamports')) {
        throw executionError(
          'invalid-rpc-response',
          'simulating',
          `The ${label} account response contains a malformed account at index ${String(index)}.`,
        );
      }
      return parseRpcLamports(account.lamports, `${label} account balance ${String(index)}`);
    }),
  );
}

function parseSimulationLogs(value: unknown): readonly string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_SIMULATION_LOG_LINES) {
    throw executionError(
      'invalid-rpc-response',
      'simulating',
      'The simulation log response is malformed.',
    );
  }
  let characters = 0;
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length > MAX_SIMULATION_LOG_LINE_CHARACTERS) {
      throw executionError(
        'invalid-rpc-response',
        'simulating',
        'The simulation log response is malformed.',
      );
    }
    characters += entry.length;
    if (characters > MAX_SIMULATION_LOG_CHARACTERS) {
      throw executionError(
        'invalid-rpc-response',
        'simulating',
        'The simulation log response exceeds its safe size limit.',
      );
    }
  }
  return Object.freeze([...value]);
}

function parseBoundedInnerInstructions(value: unknown): unknown {
  if (!Array.isArray(value) || value.length > MAX_SIMULATION_INNER_GROUPS) {
    throw executionError(
      'invalid-rpc-response',
      'simulating',
      'The simulation inner-instruction response is malformed or exceeds its safe group limit.',
    );
  }
  const groups = value.map((group) => {
    if (!isRecord(group) || !Array.isArray(group.instructions)) {
      throw executionError(
        'invalid-rpc-response',
        'simulating',
        'The simulation inner-instruction response is malformed.',
      );
    }
    if (group.instructions.length > MAX_SIMULATION_INSTRUCTIONS) {
      throw executionError(
        'invalid-rpc-response',
        'simulating',
        'The simulation inner-instruction response exceeds its safe instruction limit.',
      );
    }
    const instructions = group.instructions.map((instruction) => {
      if (
        isRecord(instruction) &&
        Array.isArray(instruction.accounts) &&
        instruction.accounts.length > MAX_SIMULATION_INSTRUCTION_ACCOUNTS
      ) {
        throw executionError(
          'invalid-rpc-response',
          'simulating',
          'A simulation inner instruction exceeds its safe account limit.',
        );
      }
      return instruction;
    });
    return Object.freeze({ ...group, instructions: Object.freeze(instructions) });
  });
  return Object.freeze(groups);
}

function parseSimulationAccountBalances(
  preValue: readonly bigint[],
  postValue: readonly bigint[],
  accountAddresses: readonly string[],
): readonly WokeTransactionSimulationAccountBalance[] {
  if (
    preValue.length !== accountAddresses.length ||
    postValue.length !== accountAddresses.length ||
    preValue.length > MAX_SIMULATION_ACCOUNT_QUERY_ADDRESSES
  ) {
    throw executionError(
      'invalid-rpc-response',
      'simulating',
      'The simulation account-balance response does not match the signed transaction accounts.',
    );
  }
  return Object.freeze(
    accountAddresses.map((accountAddress, index) => {
      const preLamports = preValue[index];
      const postLamports = postValue[index];
      if (preLamports === undefined || postLamports === undefined) {
        throw executionError(
          'invalid-rpc-response',
          'simulating',
          'The simulation account-balance response is incomplete.',
        );
      }
      return Object.freeze({
        address: accountAddress,
        preLamports,
        postLamports,
        deltaLamports: postLamports - preLamports,
      });
    }),
  );
}

async function fetchBlockHeight(
  rpc: ReturnType<typeof createSolanaRpc>,
  minContextSlot: bigint,
  scope: OperationScope,
  stage: WokeTransactionExecutionStage,
): Promise<bigint> {
  const value = await sendRpcRequest(
    rpc.getBlockHeight({
      commitment: 'confirmed',
      minContextSlot: minContextSlot as Parameters<
        ReturnType<typeof createSolanaRpc>['getBlockHeight']
      >[0] extends { minContextSlot?: infer TSlot }
        ? TSlot
        : never,
    }),
    scope,
    stage,
    'getBlockHeight',
  );
  return parseNonnegativeRpcBigint(value, 'block height', stage);
}

async function broadcastExactTransaction(
  rpc: ReturnType<typeof createSolanaRpc>,
  wireTransactionBase64: string,
  expectedSignature: string,
  minContextSlot: bigint,
  state: SendAttemptState,
  limits: Required<WokeTransactionExecutionLimits>,
  scope: OperationScope,
): Promise<void> {
  if (state.attempts >= limits.maxSendAttempts) return;
  state.attempts += 1;
  try {
    const returnedSignature = await sendRpcRequest(
      rpc.sendTransaction(
        wireTransactionBase64 as Parameters<
          ReturnType<typeof createSolanaRpc>['sendTransaction']
        >[0],
        {
          encoding: 'base64',
          maxRetries: 0n,
          minContextSlot: minContextSlot as Parameters<
            ReturnType<typeof createSolanaRpc>['sendTransaction']
          >[1] extends { minContextSlot?: infer TSlot }
            ? TSlot
            : never,
          preflightCommitment: 'confirmed',
          skipPreflight: true,
        },
      ),
      scope,
      'broadcasting',
      'sendTransaction',
    );
    if (typeof returnedSignature !== 'string' || returnedSignature !== expectedSignature) {
      throw executionError(
        'broadcast-mismatch',
        'broadcasting',
        'The provider returned a signature for different transaction bytes.',
      );
    }
    state.lastError = undefined;
  } catch (error) {
    if (error instanceof WokeTransactionExecutionError && error.code === 'broadcast-mismatch') {
      throw error;
    }
    state.lastError = error instanceof Error ? error : new Error('Unknown broadcast failure');
  }
}

async function waitForFinalization(input: {
  readonly rpc: ReturnType<typeof createSolanaRpc>;
  readonly context: ValidatedWokeNetContext;
  readonly transactionSignature: string;
  readonly wireTransactionBase64: string;
  readonly latestBlockhash: LatestBlockhash;
  readonly sendState: SendAttemptState;
  readonly limits: Required<WokeTransactionExecutionLimits>;
  readonly scope: OperationScope;
}): Promise<{ readonly slot: bigint; readonly attempts: number }> {
  let observedOnChain = false;
  let lastConfirmationError: Error | undefined = input.sendState.lastError;

  for (let attempt = 1; attempt <= input.limits.maxConfirmationAttempts; attempt += 1) {
    if (attempt > 1) {
      await sleep(input.limits.pollIntervalMs, input.scope, 'confirming');
    }
    input.scope.assertActive('confirming');
    try {
      await assertProviderIdentity(input.rpc, input.context, input.scope, 'confirming');
      const response = await sendRpcRequest(
        input.rpc.getSignatureStatuses(
          [
            input.transactionSignature as Parameters<
              ReturnType<typeof createSolanaRpc>['getSignatureStatuses']
            >[0][number],
          ],
          { searchTransactionHistory: true },
        ),
        input.scope,
        'confirming',
        'getSignatureStatuses',
      );
      if (
        !isRecord(response) ||
        !isRecord(response.context) ||
        typeof response.context.slot !== 'bigint' ||
        response.context.slot < input.latestBlockhash.contextSlot ||
        !Array.isArray(response.value) ||
        response.value.length !== 1
      ) {
        throw executionError(
          'invalid-rpc-response',
          'confirming',
          'The provider returned a malformed signature-status response.',
        );
      }
      const rawStatus = response.value[0];
      if (rawStatus !== null) {
        const status = parseSignatureStatus(rawStatus, response.context.slot);
        observedOnChain = true;
        if (status.err !== null) {
          throw executionError(
            'transaction-failed',
            'confirming',
            'The finalized WokeNet transaction contains an execution error.',
          );
        }
        if (status.confirmationStatus === 'finalized') {
          // Bind the final observation to the expected network one last time.
          await assertProviderIdentity(input.rpc, input.context, input.scope, 'confirming');
          return { slot: status.slot, attempts: attempt };
        }
      }

      if (!observedOnChain) {
        const currentBlockHeight = await fetchBlockHeight(
          input.rpc,
          input.latestBlockhash.contextSlot,
          input.scope,
          'confirming',
        );
        if (currentBlockHeight > input.latestBlockhash.lastValidBlockHeight) {
          throw executionError(
            'transaction-expired',
            'confirming',
            'The WokeNet blockhash expired before the transaction was observed onchain.',
          );
        }
        if (
          input.sendState.attempts < input.limits.maxSendAttempts &&
          attempt % input.limits.rebroadcastEveryAttempts === 0
        ) {
          await broadcastExactTransaction(
            input.rpc,
            input.wireTransactionBase64,
            input.transactionSignature,
            input.latestBlockhash.contextSlot,
            input.sendState,
            input.limits,
            input.scope,
          );
        }
      }
      lastConfirmationError = undefined;
    } catch (error) {
      if (
        error instanceof WokeTransactionExecutionError &&
        [
          'aborted',
          'broadcast-mismatch',
          'invalid-rpc-response',
          'provider-mismatch',
          'timeout',
          'transaction-expired',
          'transaction-failed',
        ].includes(error.code)
      ) {
        throw error;
      }
      lastConfirmationError =
        error instanceof Error ? error : new Error('Unknown confirmation failure');
    }
  }

  throw executionError(
    'confirmation-timeout',
    'confirming',
    'The transaction did not reach finalized commitment within the configured bounds.',
    lastConfirmationError ?? input.sendState.lastError,
  );
}

function parseSignatureStatus(
  value: unknown,
  responseContextSlot: bigint,
): ValidatedSignatureStatus {
  if (
    !isRecord(value) ||
    typeof value.slot !== 'bigint' ||
    value.slot < 0n ||
    value.slot > responseContextSlot ||
    !['processed', 'confirmed', 'finalized'].includes(
      typeof value.confirmationStatus === 'string' ? value.confirmationStatus : '',
    ) ||
    !Object.hasOwn(value, 'err') ||
    (value.confirmations !== null &&
      (typeof value.confirmations !== 'bigint' || value.confirmations < 0n)) ||
    !isRecord(value.status)
  ) {
    throw executionError(
      'invalid-rpc-response',
      'confirming',
      'The provider returned a malformed transaction status.',
    );
  }

  const confirmationStatus = value.confirmationStatus as 'processed' | 'confirmed' | 'finalized';
  const statusKeys = Object.keys(value.status);
  const legacyOk = statusKeys.length === 1 && statusKeys[0] === 'Ok' && value.status.Ok === null;
  const legacyError =
    statusKeys.length === 1 && statusKeys[0] === 'Err' && value.status.Err !== undefined;
  const finalizedConfirmationsAreConsistent =
    confirmationStatus === 'finalized'
      ? value.confirmations === null
      : typeof value.confirmations === 'bigint';
  const resultIsConsistent = value.err === null ? legacyOk : legacyError;
  if (!finalizedConfirmationsAreConsistent || !resultIsConsistent) {
    throw executionError(
      'invalid-rpc-response',
      'confirming',
      'The provider returned an internally contradictory transaction status.',
    );
  }

  return {
    slot: value.slot,
    confirmationStatus,
    err: value.err,
  };
}

function decodeSystemEffects(innerInstructions: unknown): DecodedSystemEffects {
  if (!Array.isArray(innerInstructions)) {
    throw executionError(
      'simulation-mismatch',
      'simulating',
      'The legacy SOL settlement simulation did not return inner instructions.',
    );
  }
  const transfers: WokePaymentSimulation['transfers'][number][] = [];
  const accountCreations: ObservedSystemAccountCreation[] = [];
  for (const group of innerInstructions) {
    if (!isRecord(group) || group.index !== 0 || !Array.isArray(group.instructions)) {
      throw executionError(
        'simulation-mismatch',
        'simulating',
        'The legacy SOL settlement simulation returned malformed inner-instruction groups.',
      );
    }
    for (const candidate of group.instructions) {
      if (!isRecord(candidate) || typeof candidate.programId !== 'string') {
        throw executionError(
          'simulation-mismatch',
          'simulating',
          'The legacy SOL settlement simulation returned a malformed inner instruction.',
        );
      }
      if (candidate.programId !== WOKENET_SYSTEM_PROGRAM_ADDRESS) continue;
      if (!isRecord(candidate.parsed) || typeof candidate.parsed.type !== 'string') {
        throw executionError(
          'simulation-mismatch',
          'simulating',
          'An opaque System Program instruction could conceal an unapproved SOL transfer.',
        );
      }
      if (!isRecord(candidate.parsed.info)) {
        throw executionError(
          'simulation-mismatch',
          'simulating',
          'A simulated System Program instruction is malformed.',
        );
      }
      const info = candidate.parsed.info;
      if (candidate.parsed.type === 'createAccount') {
        accountCreations.push({
          source: parseRpcAddress(info.source, 'account-creation payer'),
          newAccount: parseRpcAddress(info.newAccount, 'created account'),
          owner: parseRpcAddress(info.owner, 'created account owner'),
          lamports: parsePositiveRpcBigint(info.lamports, 'account-creation lamports'),
          space: parsePositiveRpcBigint(info.space, 'created account space'),
        });
        continue;
      }
      if (!['transfer', 'transferWithSeed'].includes(candidate.parsed.type)) {
        throw executionError(
          'simulation-mismatch',
          'simulating',
          `Unexpected System Program instruction ${candidate.parsed.type} appeared in the legacy SOL settlement simulation.`,
        );
      }
      const source = parseRpcAddress(info.source, 'simulated transfer source');
      const destination = parseRpcAddress(info.destination, 'simulated transfer destination');
      const lamports = parseNonnegativeRpcBigint(
        info.lamports,
        'simulated transfer lamports',
        'simulating',
      );
      transfers.push({
        programAddress: WOKENET_SYSTEM_PROGRAM_ADDRESS,
        source,
        destination,
        lamports,
      });
    }
  }
  return {
    transfers: Object.freeze(transfers),
    accountCreations: Object.freeze(accountCreations),
  };
}

function assertExpectedAccountCreations(
  built: BuiltWokeSettlementInstruction,
  observed: readonly ObservedSystemAccountCreation[],
  minimumRentExemptBalances: Readonly<Record<string, bigint>>,
): void {
  const rentPayerIndex = built.kind === 'woke-tip' ? 8 : 10;
  const rentPayer = built.instruction.accounts[rentPayerIndex]?.address;
  if (rentPayer === undefined) {
    throw executionError(
      'simulation-mismatch',
      'simulating',
      'The built legacy settlement is missing its rent payer.',
    );
  }
  const expected: {
    readonly newAccount: string;
    readonly space: bigint;
  }[] = [
    {
      newAccount: built.receiptAddress,
      space: PAYMENT_RECEIPT_ACCOUNT_SPACE,
    },
  ];
  if (built.kind === 'weekly-subscription' && built.priorStartedAtTimestamp === null) {
    expected.push({
      newAccount: built.entitlementAddress,
      space: SUBSCRIPTION_ENTITLEMENT_ACCOUNT_SPACE,
    });
  }
  if (observed.length !== expected.length) {
    throw executionError(
      'simulation-mismatch',
      'simulating',
      'The simulated legacy account-creation count differs from the approved settlement.',
    );
  }
  for (const expectedCreation of expected) {
    const minimumRent = minimumRentExemptBalances[String(expectedCreation.space)];
    const matching = observed.find(
      (candidate) => candidate.newAccount === expectedCreation.newAccount,
    );
    if (
      minimumRent === undefined ||
      matching === undefined ||
      matching.source !== rentPayer ||
      matching.owner !== built.context.programAddress ||
      matching.space !== expectedCreation.space ||
      matching.lamports !== minimumRent
    ) {
      throw executionError(
        'simulation-mismatch',
        'simulating',
        'A simulated legacy account creation differs from the approved rent-funded account.',
      );
    }
  }
}

function assertExactPaymentLamportEffects(
  snapshot: WokeTransactionSimulationSnapshot,
  transfers: WokePaymentSimulation['transfers'],
  accountCreations: readonly ObservedSystemAccountCreation[],
): void {
  const expectedDeltas = new Map<string, bigint>(
    snapshot.accountBalances.map((balance) => [balance.address, 0n] as const),
  );
  const addExpectedDelta = (accountAddress: string, delta: bigint): void => {
    const current = expectedDeltas.get(accountAddress);
    if (current === undefined) {
      throw executionError(
        'simulation-mismatch',
        'simulating',
        'A simulated legacy SOL effect references an account outside the signed transaction.',
      );
    }
    expectedDeltas.set(accountAddress, current + delta);
  };

  addExpectedDelta(snapshot.feePayer, -snapshot.feeLamports);
  for (const creation of accountCreations) {
    addExpectedDelta(creation.source, -creation.lamports);
    addExpectedDelta(creation.newAccount, creation.lamports);
  }
  for (const transfer of transfers) {
    addExpectedDelta(transfer.source, -transfer.lamports);
    addExpectedDelta(transfer.destination, transfer.lamports);
  }

  for (const balance of snapshot.accountBalances) {
    if (balance.deltaLamports !== expectedDeltas.get(balance.address)) {
      throw executionError(
        'simulation-mismatch',
        'simulating',
        `The simulated native balance change for ${balance.address} is not an approved fee, rent funding, or SOL transfer.`,
      );
    }
  }
}

function decodeSettlementEvents(
  logs: readonly string[] | null,
  programAddress: string,
): readonly WokeSettlementEvent[] {
  if (logs === null) {
    throw executionError(
      'simulation-mismatch',
      'simulating',
      'The successful legacy settlement simulation omitted program logs.',
    );
  }
  const stack: string[] = [];
  const events: WokeSettlementEvent[] = [];
  for (const line of logs) {
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/u.exec(line);
    if (invoke !== null) {
      const invokedProgram = invoke[1];
      const depthText = invoke[2];
      if (invokedProgram === undefined || depthText === undefined) {
        throw executionError(
          'simulation-mismatch',
          'simulating',
          'The WokeSocial program invocation log is malformed.',
        );
      }
      const depth = Number(depthText);
      if (!Number.isSafeInteger(depth) || depth < 1 || depth > 64) {
        throw executionError(
          'simulation-mismatch',
          'simulating',
          'The WokeSocial program invocation depth is invalid.',
        );
      }
      stack.length = depth - 1;
      stack.push(invokedProgram);
      continue;
    }
    const terminal = /^Program ([1-9A-HJ-NP-Za-km-z]+) (?:success|failed:.*)$/u.exec(line);
    if (terminal !== null) {
      const terminalProgram = terminal[1];
      if (terminalProgram !== undefined && stack.at(-1) === terminalProgram) {
        stack.pop();
      }
      continue;
    }
    if (!line.startsWith('Program data: ') || stack.at(-1) !== programAddress) {
      continue;
    }
    const encoded = line.slice('Program data: '.length);
    if (encoded.length > MAX_SETTLEMENT_EVENT_BASE64_CHARACTERS) {
      throw executionError(
        'simulation-mismatch',
        'simulating',
        'The legacy settlement event exceeds its safe encoded size limit.',
      );
    }
    const bytes = decodeCanonicalBase64(encoded);
    if (bytes.byteLength > MAX_SETTLEMENT_EVENT_BYTES) {
      throw executionError(
        'simulation-mismatch',
        'simulating',
        'The legacy settlement event exceeds its safe decoded size limit.',
      );
    }
    if (startsWith(bytes, WOKE_TIP_SETTLED_DISCRIMINATOR)) {
      events.push(decodeWokeTipSettled(bytes));
    } else if (startsWith(bytes, SUBSCRIPTION_SETTLED_DISCRIMINATOR)) {
      events.push(decodeSubscriptionSettled(bytes));
    }
  }
  return Object.freeze(events);
}

function decodeWokeTipSettled(bytes: Uint8Array): WokeSettlementEvent {
  const reader = new EventReader(bytes, WOKE_TIP_SETTLED_DISCRIMINATOR);
  const event = {
    kind: 'woke-tip-settled',
    eventVersion: reader.u16(),
    config: reader.address(),
    paymentConfig: reader.address(),
    receipt: reader.address(),
    payerIdentity: reader.address(),
    payerAuthority: reader.address(),
    recipientIdentity: reader.address(),
    recipientDestination: reader.address(),
    receiptNonce: reader.fixed(16),
    paymentKind: reader.paymentKind('woke-tip'),
    payerRootRotationCount: reader.u64(),
    paymentPolicySequence: reader.u64(),
    grossLamports: reader.u64(),
    feeBasisPoints: reader.u16(),
    feeDestination: reader.address(),
    feeLamports: reader.u64(),
    distributableLamports: reader.u64(),
    recipientLamports: reader.u64(),
    paidAtTimestamp: reader.i64(),
    paidAtSlot: reader.u64(),
  } as const;
  reader.finish();
  return event;
}

function decodeSubscriptionSettled(bytes: Uint8Array): WokeSettlementEvent {
  const reader = new EventReader(bytes, SUBSCRIPTION_SETTLED_DISCRIMINATOR);
  const event = {
    kind: 'subscription-settled',
    eventVersion: reader.u16(),
    config: reader.address(),
    paymentConfig: reader.address(),
    offering: reader.address(),
    receipt: reader.address(),
    entitlement: reader.address(),
    creatorIdentity: reader.address(),
    payerIdentity: reader.address(),
    payerAuthority: reader.address(),
    receiptNonce: reader.fixed(16),
    paymentKind: reader.paymentKind('weekly-subscription'),
    payerRootRotationCount: reader.u64(),
    paymentPolicySequence: reader.u64(),
    offeringStateSequence: reader.u64(),
    offeringManifestHash: reader.fixed(32),
    refundPolicyHash: reader.fixed(32),
    grossLamports: reader.u64(),
    feeBasisPoints: reader.u16(),
    feeDestination: reader.address(),
    feeLamports: reader.u64(),
    distributableLamports: reader.u64(),
    recipientSplits: reader.recipientSplits(),
    recipientAmounts: reader.u64Vector(),
    entitlementStateSequence: reader.u64(),
    settlementCount: reader.u64(),
    entitlementFromTimestamp: reader.i64(),
    entitlementUntilTimestamp: reader.i64(),
    paidAtTimestamp: reader.i64(),
    paidAtSlot: reader.u64(),
  } as const;
  reader.finish();
  return event;
}

class EventReader {
  readonly #bytes: Uint8Array;
  #offset: number;

  constructor(bytes: Uint8Array, discriminator: Uint8Array) {
    if (!startsWith(bytes, discriminator)) {
      throw executionError(
        'simulation-mismatch',
        'simulating',
        'The legacy settlement event discriminator is invalid.',
      );
    }
    this.#bytes = bytes;
    this.#offset = discriminator.byteLength;
  }

  fixed(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || this.#offset + length > this.#bytes.length) {
      throw executionError(
        'simulation-mismatch',
        'simulating',
        'The legacy settlement event is truncated.',
      );
    }
    const value = Uint8Array.from(this.#bytes.subarray(this.#offset, this.#offset + length));
    this.#offset += length;
    return value;
  }

  u8(): number {
    return this.fixed(1)[0] ?? 0;
  }

  u16(): number {
    const bytes = this.fixed(2);
    return (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8);
  }

  u32(): number {
    const bytes = this.fixed(4);
    return (
      ((bytes[0] ?? 0) |
        ((bytes[1] ?? 0) << 8) |
        ((bytes[2] ?? 0) << 16) |
        ((bytes[3] ?? 0) << 24)) >>>
      0
    );
  }

  u64(): bigint {
    const bytes = this.fixed(8);
    let value = 0n;
    for (let index = bytes.length - 1; index >= 0; index -= 1) {
      value = (value << 8n) | BigInt(bytes[index] ?? 0);
    }
    return value;
  }

  i64(): bigint {
    const value = this.u64();
    return value >= 1n << 63n ? value - (1n << 64n) : value;
  }

  address(): string {
    try {
      return getAddressDecoder().decode(this.fixed(32));
    } catch (error) {
      throw executionError(
        'simulation-mismatch',
        'simulating',
        'The legacy settlement event contains an invalid address.',
        error,
      );
    }
  }

  paymentKind<TExpected extends 'woke-tip' | 'weekly-subscription'>(
    expected: TExpected,
  ): TExpected {
    const value = this.u8();
    const decoded = value === 0 ? 'woke-tip' : value === 1 ? 'weekly-subscription' : null;
    if (decoded === null || decoded !== expected) {
      throw executionError(
        'simulation-mismatch',
        'simulating',
        'The legacy settlement event payment kind is invalid.',
      );
    }
    return decoded as TExpected;
  }

  recipientSplits(): readonly WokeRecipientSplitInput[] {
    const length = this.u32();
    if (length < 1 || length > MAX_SETTLEMENT_RECIPIENTS) {
      throw executionError(
        'simulation-mismatch',
        'simulating',
        'The legacy settlement event recipient count is invalid.',
      );
    }
    return Object.freeze(
      Array.from({ length }, () => ({
        recipientIdentity: this.address(),
        destination: this.address(),
        basisPoints: this.u16(),
      })),
    );
  }

  u64Vector(): readonly bigint[] {
    const length = this.u32();
    if (length < 1 || length > MAX_SETTLEMENT_RECIPIENTS) {
      throw executionError(
        'simulation-mismatch',
        'simulating',
        'The legacy settlement event amount count is invalid.',
      );
    }
    return Object.freeze(Array.from({ length }, () => this.u64()));
  }

  finish(): void {
    if (this.#offset !== this.#bytes.byteLength) {
      throw executionError(
        'simulation-mismatch',
        'simulating',
        'The legacy settlement event has trailing or malformed bytes.',
      );
    }
  }
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw executionError(
      'simulation-mismatch',
      'simulating',
      'The legacy settlement event log is not canonical base64.',
    );
  }
  try {
    const bytes = getBase64Encoder().encode(value);
    if (getBase64Decoder().decode(bytes) !== value) {
      throw new TypeError('non-canonical base64');
    }
    return Uint8Array.from(bytes);
  } catch (error) {
    throw executionError(
      'simulation-mismatch',
      'simulating',
      'The legacy settlement event log could not be decoded.',
      error,
    );
  }
}

function parseRpcAddress(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw executionError('simulation-mismatch', 'simulating', `The ${label} is malformed.`);
  }
  try {
    return address(value);
  } catch (error) {
    throw executionError(
      'simulation-mismatch',
      'simulating',
      `The ${label} is not a Solana address.`,
      error,
    );
  }
}

function parseNonnegativeRpcBigint(
  value: unknown,
  label: string,
  stage: WokeTransactionExecutionStage,
): bigint {
  if (typeof value !== 'bigint' || value < 0n) {
    throw executionError(
      'invalid-rpc-response',
      stage,
      `The provider returned an invalid ${label}.`,
    );
  }
  return value;
}

function parseRpcLamports(value: unknown, label: string): bigint {
  const parsed = parseNonnegativeRpcBigint(value, label, 'simulating');
  if (parsed > U64_MAX) {
    throw executionError(
      'invalid-rpc-response',
      'simulating',
      `The provider returned an invalid ${label}.`,
    );
  }
  return parsed;
}

function parsePositiveRpcBigint(value: unknown, label: string): bigint {
  const parsed = parseNonnegativeRpcBigint(value, label, 'simulating');
  if (parsed === 0n) {
    throw executionError(
      'invalid-rpc-response',
      'simulating',
      `The provider returned an invalid ${label}.`,
    );
  }
  return parsed;
}

function snapshotBuiltSettlement(
  candidate: BuiltWokeSettlementInstruction,
): BuiltWokeSettlementInstruction {
  if (!isRecord(candidate) || !['woke-tip', 'weekly-subscription'].includes(candidate.kind)) {
    throw executionError(
      'invalid-instruction',
      'validating',
      'The legacy settlement builder result is malformed.',
    );
  }
  let context: ValidatedWokeNetContext;
  try {
    context = createWokeNetContext(candidate.context);
  } catch (error) {
    throw executionError(
      'invalid-context',
      'validating',
      'The built legacy settlement context is invalid.',
      error,
    );
  }
  const instruction = snapshotInstruction(context, candidate.instruction);
  const plan = snapshotPaymentPlan(candidate.plan);
  if (
    plan.context.endpoint !== context.endpoint ||
    plan.context.genesisHash !== context.genesisHash ||
    plan.context.programAddress !== context.programAddress
  ) {
    throw executionError(
      'invalid-context',
      'validating',
      'The legacy settlement plan and instruction use different Solana deployment contexts.',
    );
  }
  const base = {
    ...candidate,
    context,
    instruction,
    plan,
    receiptNonce: Uint8Array.from(candidate.receiptNonce),
  };
  if (candidate.kind === 'woke-tip') {
    return Object.freeze(base) as BuiltWokeTipInstruction;
  }
  return Object.freeze({
    ...base,
    offeringManifestHash: Uint8Array.from(candidate.offeringManifestHash),
    refundPolicyHash: Uint8Array.from(candidate.refundPolicyHash),
  }) as BuiltWokeSubscriptionSettlementInstruction;
}

function snapshotPaymentPlan(plan: WokeNativePaymentPlan): WokeNativePaymentPlan {
  const recipientAllocations = Object.freeze(
    plan.recipientAllocations.map((allocation): WokeRecipientAllocation =>
      Object.freeze({ ...allocation }),
    ),
  );
  const transfers = Object.freeze(plan.transfers.map((transfer) => Object.freeze({ ...transfer })));
  return Object.freeze({
    ...plan,
    context: createWokeNetContext(plan.context),
    recipientAllocations,
    transfers,
  });
}

function parseRentExemptionSpaces(input: readonly number[] | undefined): readonly number[] {
  if (input === undefined) return Object.freeze([]);
  if (
    !Array.isArray(input) ||
    input.length > 16 ||
    input.some((space) => !Number.isSafeInteger(space) || space < 1 || space > 10_485_760) ||
    new Set(input).size !== input.length
  ) {
    throw executionError(
      'invalid-context',
      'validating',
      'Rent-exemption account sizes must be unique positive integers no larger than 10 MiB.',
    );
  }
  return Object.freeze([...input]);
}

function parseLimits(
  input: WokeTransactionExecutionLimits | undefined,
): Required<WokeTransactionExecutionLimits> {
  const limits = { ...DEFAULT_LIMITS, ...input };
  assertIntegerLimit(limits.maxConfirmationAttempts, 1, 300, 'maxConfirmationAttempts');
  assertIntegerLimit(limits.maxSendAttempts, 1, 10, 'maxSendAttempts');
  if (
    typeof limits.maxTransactionFeeLamports !== 'bigint' ||
    limits.maxTransactionFeeLamports < 0n ||
    limits.maxTransactionFeeLamports > U64_MAX
  ) {
    throw executionError(
      'invalid-context',
      'validating',
      `maxTransactionFeeLamports must be an integer from 0 through ${String(U64_MAX)}.`,
    );
  }
  assertIntegerLimit(limits.overallTimeoutMs, 1_000, 300_000, 'overallTimeoutMs');
  assertIntegerLimit(limits.pollIntervalMs, 0, 10_000, 'pollIntervalMs');
  assertIntegerLimit(
    limits.rebroadcastEveryAttempts,
    1,
    limits.maxConfirmationAttempts,
    'rebroadcastEveryAttempts',
  );
  assertIntegerLimit(limits.requestTimeoutMs, 100, 60_000, 'requestTimeoutMs');
  return limits;
}

function assertIntegerLimit(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw executionError(
      'invalid-context',
      'validating',
      `${label} must be an integer from ${String(minimum)} through ${String(maximum)}.`,
    );
  }
}

function createOperationScope(
  callerSignal: AbortSignal | undefined,
  limits: Required<WokeTransactionExecutionLimits>,
): OperationScope {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = (): void => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted === true) {
    forwardAbort();
  } else {
    callerSignal?.addEventListener('abort', forwardAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('WokeNet transaction operation timed out.'));
  }, limits.overallTimeoutMs);

  const error = (stage: WokeTransactionExecutionStage): WokeTransactionExecutionError =>
    executionError(
      timedOut ? 'timeout' : 'aborted',
      stage,
      timedOut
        ? 'The WokeNet transaction operation exceeded its overall timeout.'
        : 'The WokeNet transaction operation was aborted.',
    );

  return {
    signal: controller.signal,
    requestTimeoutMs: limits.requestTimeoutMs,
    assertActive(stage) {
      if (controller.signal.aborted) throw error(stage);
    },
    error,
    dispose() {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forwardAbort);
    },
  };
}

async function sendRpcRequest<T>(
  request: { send(options: { abortSignal: AbortSignal }): Promise<T> },
  scope: OperationScope,
  stage: WokeTransactionExecutionStage,
  method: string,
): Promise<T> {
  scope.assertActive(stage);
  const requestController = new AbortController();
  let requestTimedOut = false;
  const forwardAbort = (): void => requestController.abort(scope.signal.reason);
  scope.signal.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => {
    requestTimedOut = true;
    requestController.abort(new Error(`${method} timed out.`));
  }, scope.requestTimeoutMs);
  let requestAbortListener: (() => void) | undefined;
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      requestAbortListener = (): void =>
        reject(
          requestTimedOut
            ? executionError('rpc-failure', stage, `The Solana ${method} request timed out.`)
            : scope.error(stage),
        );
      requestController.signal.addEventListener('abort', requestAbortListener, {
        once: true,
      });
    });
    return await Promise.race([request.send({ abortSignal: requestController.signal }), aborted]);
  } catch (error) {
    if (scope.signal.aborted) throw scope.error(stage);
    if (error instanceof WokeTransactionExecutionError && error.code === 'rpc-failure') {
      throw error;
    }
    throw executionError(
      'rpc-failure',
      stage,
      requestTimedOut
        ? `The WokeNet ${method} request timed out.`
        : `The WokeNet ${method} request failed.`,
      error,
    );
  } finally {
    clearTimeout(timer);
    if (requestAbortListener !== undefined) {
      requestController.signal.removeEventListener('abort', requestAbortListener);
    }
    scope.signal.removeEventListener('abort', forwardAbort);
  }
}

async function awaitWithAbort<T>(
  promise: Promise<T>,
  scope: OperationScope,
  stage: WokeTransactionExecutionStage,
): Promise<T> {
  scope.assertActive(stage);
  let listener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = (): void => reject(scope.error(stage));
    scope.signal.addEventListener('abort', listener, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (listener !== undefined) {
      scope.signal.removeEventListener('abort', listener);
    }
  }
}

async function sleep(
  milliseconds: number,
  scope: OperationScope,
  stage: WokeTransactionExecutionStage,
): Promise<void> {
  if (milliseconds === 0) {
    scope.assertActive(stage);
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let listener: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      listener = (): void => reject(scope.error(stage));
      scope.signal.addEventListener('abort', listener, { once: true });
      timer = setTimeout(resolve, milliseconds);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (listener !== undefined) scope.signal.removeEventListener('abort', listener);
  }
}

function executionError(
  code: WokeTransactionExecutionErrorCode,
  stage: WokeTransactionExecutionStage,
  message: string,
  cause?: unknown,
): WokeTransactionExecutionError {
  return new WokeTransactionExecutionError(
    code,
    stage,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return (
    value.byteLength >= prefix.byteLength && prefix.every((byte, index) => value[index] === byte)
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
