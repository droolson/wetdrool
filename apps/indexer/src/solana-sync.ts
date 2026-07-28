import { networkIdSchema } from '@socially-woke/protocol';

import {
  AnchorEventDecodingError,
  decodeAnchorEventLog,
  UnsupportedAnchorEventError,
} from './anchor-events.js';
import type { OpenIndexer } from './indexer.js';
import { ManifestVerificationError } from './manifest-verifier.js';
import { ProjectionError, type IngestionStateStore, type ProjectionStore } from './projection.js';
import {
  SolanaEventMaterializationError,
  type SolanaEventMaterializer,
} from './solana-materializer.js';
import type { FinalizedSignature, FinalizedSolanaRpc, FinalizedTransaction } from './solana-rpc.js';

const SCAN_CHECKPOINT_SIGNATURE = '1'.repeat(64);
const TRANSACTION_DEAD_LETTER_LOG_INDEX = 2_147_483_647;

export interface SolanaSyncLogger {
  debug?(context: Readonly<Record<string, unknown>>, message: string): void;
  info?(context: Readonly<Record<string, unknown>>, message: string): void;
  warn?(context: Readonly<Record<string, unknown>>, message: string): void;
  error?(context: Readonly<Record<string, unknown>>, message: string): void;
}

export interface SolanaSyncOptions {
  readonly rpc: FinalizedSolanaRpc;
  readonly indexer: OpenIndexer;
  readonly projection: ProjectionStore & IngestionStateStore;
  readonly materializer: SolanaEventMaterializer;
  readonly networkId: string;
  readonly programId: string;
  readonly deploymentSlot: bigint;
  readonly batchSize: number;
  readonly pollIntervalMilliseconds: number;
  readonly retryAttempts: number;
  readonly retryBaseMilliseconds: number;
  readonly retryMaximumMilliseconds: number;
  readonly logger?: SolanaSyncLogger;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface SolanaSyncResult {
  readonly fromSlot: bigint;
  readonly finalizedTip: bigint;
  readonly signatures: number;
  readonly transactions: number;
  readonly decodedEvents: number;
  readonly appliedEvents: number;
  readonly duplicateEvents: number;
  readonly deadLetters: number;
  readonly checkpointAdvanced: boolean;
}

export class SolanaSyncConfigurationError extends Error {
  override readonly name = 'SolanaSyncConfigurationError';
}

export class SolanaSyncWorker {
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;

  constructor(private readonly options: SolanaSyncOptions) {
    const parsedNetwork = parseNetworkId(options.networkId);
    if (parsedNetwork.programId !== options.programId) {
      throw new SolanaSyncConfigurationError(
        `Network program ${parsedNetwork.programId} does not match configured program ${options.programId}.`,
      );
    }
    if (options.deploymentSlot < 0n) {
      throw new SolanaSyncConfigurationError('Deployment slot cannot be negative.');
    }
    for (const [name, value] of [
      ['batch size', options.batchSize],
      ['poll interval', options.pollIntervalMilliseconds],
      ['retry attempts', options.retryAttempts],
      ['retry base', options.retryBaseMilliseconds],
      ['retry maximum', options.retryMaximumMilliseconds],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new SolanaSyncConfigurationError(`${name} must be a positive safe integer.`);
      }
    }
    if (options.batchSize > 1_000) {
      throw new SolanaSyncConfigurationError(
        'Woke Network RPC batches cannot exceed 1,000 signatures.',
      );
    }
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? abortableSleep;
  }

  async initialize(): Promise<void> {
    await this.options.rpc.initialize();
  }

  async run(signal: AbortSignal): Promise<void> {
    await this.initialize();
    this.options.logger?.info?.(
      {
        deploymentSlot: this.options.deploymentSlot.toString(),
        networkId: this.options.networkId,
        programId: this.options.programId,
      },
      'finalized Woke Network ingestion started',
    );
    while (!signal.aborted) {
      try {
        const result = await this.runOnce(signal);
        this.options.logger?.debug?.(
          {
            ...result,
            fromSlot: result.fromSlot.toString(),
            finalizedTip: result.finalizedTip.toString(),
          },
          'finalized Woke Network ingestion poll completed',
        );
      } catch (error) {
        if (signal.aborted) {
          break;
        }
        this.options.logger?.error?.(
          { error: errorMessage(error) },
          'finalized Woke Network ingestion poll failed',
        );
      }
      await this.#sleep(this.options.pollIntervalMilliseconds, signal);
    }
  }

  async runOnce(signal?: AbortSignal): Promise<SolanaSyncResult> {
    await this.initialize();
    throwIfAborted(signal);

    const finalizedTip = await this.options.rpc.finalizedSlot();
    const checkpoint = await this.options.projection.checkpoint(this.options.networkId);
    const fromSlot =
      checkpoint === undefined || checkpoint < this.options.deploymentSlot
        ? this.options.deploymentSlot
        : checkpoint;
    const signatures = await this.#collectSignatures(fromSlot, finalizedTip, signal);
    let transactions = 0;
    let decodedEvents = 0;
    let appliedEvents = 0;
    let duplicateEvents = 0;
    let deadLetters = 0;
    let hasUnresolvedFailure = false;

    signatureLoop: for (const signatureInfo of signatures) {
      throwIfAborted(signal);
      if (signatureInfo.failed) {
        continue;
      }

      const pendingTransaction = await this.options.projection.deadLetter(
        this.options.networkId,
        signatureInfo.signature,
        TRANSACTION_DEAD_LETTER_LOG_INDEX,
      );
      if (
        pendingTransaction?.nextAttemptAt !== undefined &&
        Date.parse(pendingTransaction.nextAttemptAt) > this.#now()
      ) {
        hasUnresolvedFailure = true;
        break;
      }

      let transaction: FinalizedTransaction | null;
      try {
        transaction = await this.#withRetry(
          () => this.options.rpc.transaction(signatureInfo.signature),
          signal,
        );
        if (transaction === null) {
          throw new Error('Finalized transaction is unavailable from every RPC endpoint.');
        }
        this.#validateTransaction(signatureInfo, transaction);
        await this.options.projection.resolveDeadLetter(
          this.options.networkId,
          signatureInfo.signature,
          TRANSACTION_DEAD_LETTER_LOG_INDEX,
        );
      } catch (error) {
        const deferred = await this.#deferTransaction(signatureInfo, error);
        hasUnresolvedFailure = true;
        deadLetters += deferred ? 1 : 0;
        break;
      }

      transactions += 1;
      const logs = extractProgramDataLogs(transaction.logMessages, this.options.programId);
      for (const log of logs) {
        throwIfAborted(signal);
        const pending = await this.options.projection.deadLetter(
          this.options.networkId,
          transaction.signature,
          log.logIndex,
        );
        if (
          pending?.nextAttemptAt !== undefined &&
          Date.parse(pending.nextAttemptAt) > this.#now()
        ) {
          hasUnresolvedFailure = true;
          break signatureLoop;
        }

        let countedDecodedEvent = false;
        try {
          const result = await this.#withRetry(async () => {
            const decoded = decodeAnchorEventLog(log.encodedData);
            if (!countedDecodedEvent) {
              decodedEvents += 1;
              countedDecodedEvent = true;
            }
            const event = await this.options.materializer.materialize(decoded, {
              networkId: this.options.networkId,
              programId: this.options.programId,
              transactionSignature: transaction.signature,
              ...(signatureInfo.transactionIndex === undefined
                ? {}
                : { transactionIndex: signatureInfo.transactionIndex }),
              slot: transaction.slot,
              logIndex: log.logIndex,
              blockTime: requireBlockTime(transaction.blockTime),
            });
            return this.options.indexer.ingest(event);
          }, signal);
          await this.options.projection.resolveDeadLetter(
            this.options.networkId,
            transaction.signature,
            log.logIndex,
          );
          if (result?.applied === true) {
            appliedEvents += 1;
          } else if (result?.applied === false) {
            duplicateEvents += 1;
          }
        } catch (error) {
          await this.#recordDeadLetter({
            transactionSignature: transaction.signature,
            logIndex: log.logIndex,
            eventBody: {
              encodedData: log.encodedData,
              slot: transaction.slot.toString(),
              blockTime: transaction.blockTime,
            },
            error,
          });
          deadLetters += 1;
          hasUnresolvedFailure = true;
          break signatureLoop;
        }
      }
    }

    if (!hasUnresolvedFailure) {
      await this.options.projection.advanceCheckpoint(
        this.options.networkId,
        finalizedTip,
        signatures.at(-1)?.signature ?? SCAN_CHECKPOINT_SIGNATURE,
        TRANSACTION_DEAD_LETTER_LOG_INDEX,
      );
    }

    return {
      fromSlot,
      finalizedTip,
      signatures: signatures.length,
      transactions,
      decodedEvents,
      appliedEvents,
      duplicateEvents,
      deadLetters,
      checkpointAdvanced: !hasUnresolvedFailure,
    };
  }

  async #collectSignatures(
    fromSlot: bigint,
    finalizedTip: bigint,
    signal?: AbortSignal,
  ): Promise<readonly FinalizedSignature[]> {
    const collected = new Map<string, FinalizedSignature>();
    let before: string | undefined;
    let reachedLowerBound = false;

    while (!reachedLowerBound) {
      throwIfAborted(signal);
      const page = await this.#withRetry(
        () =>
          this.options.rpc.signaturesForProgram({
            programId: this.options.programId,
            limit: this.options.batchSize,
            ...(before === undefined ? {} : { before }),
          }),
        signal,
      );
      if (page.length === 0) {
        break;
      }

      for (const item of page) {
        if (item.slot < fromSlot) {
          reachedLowerBound = true;
          continue;
        }
        if (item.confirmationStatus === 'processed' || item.confirmationStatus === 'confirmed') {
          throw new Error(
            'RPC returned a non-finalized signature for a finalized commitment request.',
          );
        }
        if (
          item.slot <= finalizedTip &&
          (item.confirmationStatus === null || item.confirmationStatus === 'finalized')
        ) {
          collected.set(item.signature, item);
        }
      }

      const lastSignature = page.at(-1)?.signature;
      if (
        lastSignature === undefined ||
        lastSignature === before ||
        page.length < this.options.batchSize
      ) {
        break;
      }
      before = lastSignature;
    }

    return [...collected.values()].sort(compareSignatureOrder);
  }

  #validateTransaction(signatureInfo: FinalizedSignature, transaction: FinalizedTransaction): void {
    if (transaction.signature !== signatureInfo.signature) {
      throw new Error('RPC returned a transaction with a different signature.');
    }
    if (transaction.slot !== signatureInfo.slot) {
      throw new Error('RPC signature and transaction slots do not match.');
    }
    if (transaction.failed) {
      throw new Error('RPC returned a failed transaction as successful.');
    }
    requireBlockTime(transaction.blockTime);
  }

  async #deferTransaction(signatureInfo: FinalizedSignature, error: unknown): Promise<boolean> {
    const pending = await this.options.projection.deadLetter(
      this.options.networkId,
      signatureInfo.signature,
      TRANSACTION_DEAD_LETTER_LOG_INDEX,
    );
    if (pending?.nextAttemptAt !== undefined && Date.parse(pending.nextAttemptAt) > this.#now()) {
      return false;
    }
    await this.#recordDeadLetter({
      transactionSignature: signatureInfo.signature,
      logIndex: TRANSACTION_DEAD_LETTER_LOG_INDEX,
      eventBody: {
        signature: signatureInfo.signature,
        slot: signatureInfo.slot.toString(),
        blockTime: signatureInfo.blockTime,
      },
      error,
    });
    return true;
  }

  async #recordDeadLetter(input: {
    readonly transactionSignature: string;
    readonly logIndex: number;
    readonly eventBody: Readonly<Record<string, unknown>>;
    readonly error: unknown;
  }): Promise<void> {
    const current = await this.options.projection.deadLetter(
      this.options.networkId,
      input.transactionSignature,
      input.logIndex,
    );
    const attempts = (current?.attempts ?? 0) + 1;
    const delay = retryDelay(
      attempts,
      this.options.retryBaseMilliseconds,
      this.options.retryMaximumMilliseconds,
    );
    await this.options.projection.recordDeadLetter({
      networkId: this.options.networkId,
      transactionSignature: input.transactionSignature,
      logIndex: input.logIndex,
      eventBody: input.eventBody,
      failureCode: failureCode(input.error),
      failureDetail: errorMessage(input.error).slice(0, 2_000),
      nextAttemptAt: new Date(this.#now() + delay).toISOString(),
    });
    this.options.logger?.warn?.(
      {
        transactionSignature: input.transactionSignature,
        logIndex: input.logIndex,
        failureCode: failureCode(input.error),
        attempts,
      },
      'Woke Network ingestion item moved to the retryable dead-letter queue',
    );
  }

  async #withRetry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.options.retryAttempts; attempt += 1) {
      throwIfAborted(signal);
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt < this.options.retryAttempts) {
          await this.#sleep(
            retryDelay(
              attempt,
              this.options.retryBaseMilliseconds,
              this.options.retryMaximumMilliseconds,
            ),
            signal,
          );
        }
      }
    }
    throw lastError;
  }
}

export interface ProgramDataLog {
  readonly logIndex: number;
  readonly encodedData: string;
}

export function extractProgramDataLogs(
  logs: readonly string[],
  programId: string,
): readonly ProgramDataLog[] {
  const invocationStack: string[] = [];
  const result: ProgramDataLog[] = [];

  logs.forEach((log, logIndex) => {
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[\d+\]$/u.exec(log);
    if (invoke?.[1] !== undefined) {
      invocationStack.push(invoke[1]);
      return;
    }

    const completed = /^Program ([1-9A-HJ-NP-Za-km-z]+) (?:success|failed:.*)$/u.exec(log);
    if (completed?.[1] !== undefined) {
      const lastIndex = invocationStack.lastIndexOf(completed[1]);
      if (lastIndex >= 0) {
        invocationStack.splice(lastIndex);
      }
      return;
    }

    if (invocationStack.at(-1) !== programId) {
      return;
    }
    const eventData = /^Program data: (.+)$/u.exec(log)?.[1];
    if (eventData !== undefined) {
      result.push({ logIndex, encodedData: eventData });
    }
  });
  return result;
}

function parseNetworkId(networkId: string): {
  readonly genesisHash: string;
  readonly programId: string;
} {
  const parsed = networkIdSchema.safeParse(networkId);
  const [, , genesisHash, programId] = parsed.success ? parsed.data.split(':') : [];
  if (genesisHash === undefined || programId === undefined) {
    throw new SolanaSyncConfigurationError(
      'Network ID must be woke:v1:<32-byte-genesis-hash>:<32-byte-program-id>.',
    );
  }
  return { genesisHash, programId };
}

function compareSignatureOrder(left: FinalizedSignature, right: FinalizedSignature): number {
  if (left.slot !== right.slot) {
    return left.slot < right.slot ? -1 : 1;
  }
  if (
    left.transactionIndex !== undefined &&
    right.transactionIndex !== undefined &&
    left.transactionIndex !== right.transactionIndex
  ) {
    return left.transactionIndex - right.transactionIndex;
  }
  return left.signature.localeCompare(right.signature);
}

function requireBlockTime(value: number | null): number {
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Finalized transaction has no valid block time.');
  }
  return value;
}

function failureCode(error: unknown): string {
  if (error instanceof SolanaEventMaterializationError) {
    return error.code;
  }
  if (error instanceof ManifestVerificationError) {
    return error.code;
  }
  if (error instanceof ProjectionError) {
    return error.code;
  }
  if (error instanceof UnsupportedAnchorEventError) {
    return 'unsupported-anchor-event';
  }
  if (error instanceof AnchorEventDecodingError) {
    return 'malformed-anchor-event';
  }
  return 'ingestion-failed';
}

function retryDelay(attempt: number, base: number, maximum: number): number {
  return Math.min(maximum, base * 2 ** Math.min(attempt - 1, 30));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Woke Network sync aborted.');
  }
}

async function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
