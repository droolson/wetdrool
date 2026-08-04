import { networkIdSchema } from '@wetdrool/protocol';

import {
  AnchorEventDecodingError,
  decodeAnchorEventLog,
  UnsupportedAnchorEventError,
} from './anchor-events.js';
import type { ProtocolEvent } from './events.js';
import type { OpenIndexer } from './indexer.js';
import {
  isTerminalManifestVerificationError,
  ManifestVerificationError,
} from './manifest-verifier.js';
import {
  ProjectionError,
  type IngestionStateStore,
  type ManifestEventDisposition,
  type PendingManifestRecord,
  type ProjectionStore,
} from './projection.js';
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
  readonly onPollSucceeded?: (result: SolanaSyncResult) => void;
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
  readonly quarantinedEvents: number;
  readonly deferredManifestEvents: number;
  readonly hydratedManifestEvents: number;
  readonly deadLetters: number;
  readonly checkpointAdvanced: boolean;
}

interface PendingManifestHydrationOutcome {
  readonly hydratedManifestEvents: number;
  readonly duplicateEvents: number;
  readonly quarantinedEvents: number;
  readonly deadLetters: number;
}

interface MutablePendingManifestHydrationOutcome {
  hydratedManifestEvents: number;
  duplicateEvents: number;
  quarantinedEvents: number;
  deadLetters: number;
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
      throw new SolanaSyncConfigurationError('Solana RPC batches cannot exceed 1,000 signatures.');
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
      'finalized DroolNet ingestion started',
    );
    while (!signal.aborted) {
      try {
        const result = await this.runOnce(signal);
        this.options.onPollSucceeded?.(result);
        this.options.logger?.debug?.(
          {
            ...result,
            fromSlot: result.fromSlot.toString(),
            finalizedTip: result.finalizedTip.toString(),
          },
          'finalized DroolNet ingestion poll completed',
        );
      } catch (error) {
        if (signal.aborted) {
          break;
        }
        this.options.logger?.error?.(
          { error: errorMessage(error) },
          'finalized DroolNet ingestion poll failed',
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
    let quarantinedEvents = 0;
    let deferredManifestEvents = 0;
    let hydratedManifestEvents = 0;
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
        const operationalRecord = await this.options.projection.deadLetter(
          this.options.networkId,
          transaction.signature,
          log.logIndex,
        );
        let materializedEvent: ProtocolEvent | undefined;
        try {
          materializedEvent = await this.#withRetry(async () => {
            const decoded = decodeAnchorEventLog(log.encodedData);
            return this.options.materializer.materialize(decoded, {
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
          }, signal);
          decodedEvents += 1;
        } catch (error) {
          if (
            operationalRecord?.nextAttemptAt !== undefined &&
            Date.parse(operationalRecord.nextAttemptAt) > this.#now()
          ) {
            hasUnresolvedFailure = true;
            break signatureLoop;
          }
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

        let disposition: ManifestEventDisposition | undefined;
        try {
          disposition = await this.options.projection.manifestEventDisposition(materializedEvent);
        } catch (error) {
          await this.#recordDeadLetter({
            transactionSignature: transaction.signature,
            logIndex: log.logIndex,
            eventBody: this.#eventBody(log, transaction),
            error,
          });
          deadLetters += 1;
          hasUnresolvedFailure = true;
          break signatureLoop;
        }

        if (disposition?.state === 'accepted') {
          if (operationalRecord?.terminalFailureCode !== undefined) {
            hasUnresolvedFailure = true;
            break signatureLoop;
          }
          await this.options.projection.resolveDeadLetter(
            this.options.networkId,
            transaction.signature,
            log.logIndex,
          );
          duplicateEvents += 1;
          continue;
        }
        if (disposition?.state === 'terminal') {
          if (
            operationalRecord?.terminalFailureCode !== undefined &&
            operationalRecord.terminalFailureCode !== disposition.failureCode
          ) {
            hasUnresolvedFailure = true;
            break signatureLoop;
          }
          continue;
        }

        if (disposition?.state === 'pending') {
          // Pending hydration is drained from durable retry state after the
          // finalized RPC scan, so an inclusive log replay cannot fetch the
          // same manifest twice or impede checkpoint progress.
          continue;
        }

        if (
          operationalRecord !== undefined &&
          (operationalRecord.nextAttemptAt === undefined ||
            Date.parse(operationalRecord.nextAttemptAt) > this.#now())
        ) {
          hasUnresolvedFailure = true;
          break signatureLoop;
        }

        try {
          const result = await this.#withRetry(
            () => this.options.indexer.ingest(materializedEvent),
            signal,
          );
          await this.options.projection.resolveDeadLetter(
            this.options.networkId,
            transaction.signature,
            log.logIndex,
          );
          if (result.applied) {
            appliedEvents += 1;
          } else {
            duplicateEvents += 1;
          }
        } catch (error) {
          if (isTerminalManifestVerificationError(error)) {
            try {
              const quarantined = await this.options.projection.quarantineManifestEvent(
                materializedEvent,
                {
                  eventBody: this.#eventBody(log, transaction),
                  failureCode: error.code,
                  failureDetail: errorMessage(error).slice(0, 2_000),
                },
              );
              if (quarantined) {
                deadLetters += 1;
                quarantinedEvents += 1;
                this.options.logger?.warn?.(
                  {
                    transactionSignature: transaction.signature,
                    logIndex: log.logIndex,
                    failureCode: error.code,
                  },
                  'DroolNet manifest event was terminally quarantined',
                );
              }
              continue;
            } catch (quarantineError) {
              await this.#recordDeadLetter({
                transactionSignature: transaction.signature,
                logIndex: log.logIndex,
                eventBody: this.#eventBody(log, transaction),
                error: quarantineError,
              });
              deadLetters += 1;
              hasUnresolvedFailure = true;
              break signatureLoop;
            }
          }
          if (isManifestUnavailable(error) && isDeferrableManifestEvent(materializedEvent)) {
            try {
              const deferred = await this.#deferManifestEvent(
                materializedEvent,
                log,
                transaction,
                error,
              );
              if (deferred) {
                deferredManifestEvents += 1;
                deadLetters += 1;
              }
              continue;
            } catch (deferralError) {
              await this.#recordDeadLetter({
                transactionSignature: transaction.signature,
                logIndex: log.logIndex,
                eventBody: this.#eventBody(log, transaction),
                error: deferralError,
              });
              deadLetters += 1;
              hasUnresolvedFailure = true;
              break signatureLoop;
            }
          }
          await this.#recordDeadLetter({
            transactionSignature: transaction.signature,
            logIndex: log.logIndex,
            eventBody: this.#eventBody(log, transaction),
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

    const hydration = await this.#drainDuePendingManifests(signal);
    hydratedManifestEvents += hydration.hydratedManifestEvents;
    duplicateEvents += hydration.duplicateEvents;
    quarantinedEvents += hydration.quarantinedEvents;
    deadLetters += hydration.deadLetters;

    return {
      fromSlot,
      finalizedTip,
      signatures: signatures.length,
      transactions,
      decodedEvents,
      appliedEvents,
      duplicateEvents,
      quarantinedEvents,
      deferredManifestEvents,
      hydratedManifestEvents,
      deadLetters,
      checkpointAdvanced: !hasUnresolvedFailure,
    };
  }

  #eventBody(
    log: ProgramDataLog,
    transaction: FinalizedTransaction,
  ): Readonly<Record<string, unknown>> {
    return {
      encodedData: log.encodedData,
      slot: transaction.slot.toString(),
      blockTime: transaction.blockTime,
    };
  }

  async #deferManifestEvent(
    event: ProtocolEvent,
    log: ProgramDataLog,
    transaction: FinalizedTransaction,
    error: ManifestVerificationError,
  ): Promise<boolean> {
    const current = await this.options.projection.deadLetter(
      event.networkId,
      event.transactionSignature,
      event.logIndex,
    );
    const attempts = (current?.attempts ?? 0) + 1;
    const delay = retryDelay(
      attempts,
      this.options.retryBaseMilliseconds,
      this.options.retryMaximumMilliseconds,
    );
    const deferred = await this.options.projection.deferManifestEvent(event, {
      eventBody: this.#eventBody(log, transaction),
      failureCode: 'manifest-unavailable',
      failureDetail: errorMessage(error).slice(0, 2_000),
      nextAttemptAt: new Date(this.#now() + delay).toISOString(),
    });
    if (deferred) {
      this.options.logger?.warn?.(
        {
          transactionSignature: event.transactionSignature,
          logIndex: event.logIndex,
          failureCode: 'manifest-unavailable',
          attempts,
        },
        'DroolNet manifest hydration was deferred without blocking finalized ingestion',
      );
    }
    return deferred;
  }

  async #recordPendingManifestRetry(
    pending: PendingManifestRecord,
    error: unknown,
  ): Promise<boolean> {
    const attempts = pending.attempts + 1;
    const delay = retryDelay(
      attempts,
      this.options.retryBaseMilliseconds,
      this.options.retryMaximumMilliseconds,
    );
    const rescheduled = await this.options.projection.reschedulePendingManifestEvent(
      pending.event,
      {
        eventBody: pending.eventBody,
        failureCode: 'manifest-unavailable',
        failureDetail:
          `Pending manifest hydration remains incomplete: ${errorMessage(error)}`.slice(0, 2_000),
        nextAttemptAt: new Date(this.#now() + delay).toISOString(),
      },
    );
    if (rescheduled === undefined) {
      return false;
    }
    this.options.logger?.warn?.(
      {
        transactionSignature: pending.event.transactionSignature,
        logIndex: pending.event.logIndex,
        failureCode: failureCode(error),
        attempts: rescheduled.attempts,
      },
      'DroolNet pending manifest hydration will retry without blocking finalized ingestion',
    );
    return true;
  }

  async #drainDuePendingManifests(signal?: AbortSignal): Promise<PendingManifestHydrationOutcome> {
    const due = await this.options.projection.duePendingManifestEvents(
      this.options.networkId,
      new Date(this.#now()).toISOString(),
      this.options.batchSize,
    );
    const outcome: MutablePendingManifestHydrationOutcome = {
      hydratedManifestEvents: 0,
      duplicateEvents: 0,
      quarantinedEvents: 0,
      deadLetters: 0,
    };
    for (const pending of due) {
      throwIfAborted(signal);
      try {
        const verified = await this.#withRetry(
          () => this.options.indexer.verifyEvent(pending.event),
          signal,
        );
        if (verified.manifest === undefined) {
          throw new ProjectionError(
            'A pending manifest event no longer requires a manifest.',
            'manifest-mismatch',
          );
        }
        const promoted = await this.options.projection.promoteManifestEvent(
          pending.event,
          verified.manifest,
        );
        if (promoted) {
          outcome.hydratedManifestEvents += 1;
        } else {
          outcome.duplicateEvents += 1;
        }
      } catch (error) {
        if (isTerminalManifestVerificationError(error)) {
          try {
            const rejected = await this.options.projection.rejectPendingManifestEvent(
              pending.event,
              {
                eventBody: pending.eventBody,
                failureCode: error.code,
                failureDetail: errorMessage(error).slice(0, 2_000),
              },
            );
            if (rejected) {
              outcome.quarantinedEvents += 1;
              outcome.deadLetters += 1;
            }
            continue;
          } catch (rejectionError) {
            if (await this.#recordPendingManifestRetry(pending, rejectionError)) {
              outcome.deadLetters += 1;
            }
            continue;
          }
        }
        if (await this.#recordPendingManifestRetry(pending, error)) {
          outcome.deadLetters += 1;
        }
      }
    }
    return outcome;
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
          const existing = collected.get(item.signature);
          if (
            existing !== undefined &&
            (existing.slot !== item.slot ||
              existing.transactionIndex !== item.transactionIndex ||
              existing.failed !== item.failed ||
              existing.blockTime !== item.blockTime)
          ) {
            throw new Error('RPC returned conflicting metadata for one finalized signature.');
          }
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

    const signatures = [...collected.values()];
    assertUnambiguousSignatureOrder(signatures);
    return signatures.sort(compareSignatureOrder);
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
      'DroolNet ingestion item moved to the retryable dead-letter queue',
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
        if (isTerminalManifestVerificationError(error)) {
          throw error;
        }
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
      'Network ID must be droolnet:v1:<32-byte-genesis-hash>:<32-byte-program-id>.',
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
  return left.signature === right.signature ? 0 : left.signature < right.signature ? -1 : 1;
}

function assertUnambiguousSignatureOrder(signatures: readonly FinalizedSignature[]): void {
  const transactionsBySlot = new Map<string, Map<string, number | undefined>>();
  for (const item of signatures) {
    const slot = item.slot.toString();
    let transactions = transactionsBySlot.get(slot);
    if (transactions === undefined) {
      transactions = new Map();
      transactionsBySlot.set(slot, transactions);
    }
    transactions.set(item.signature, item.transactionIndex);
  }
  for (const transactions of transactionsBySlot.values()) {
    if (transactions.size <= 1) {
      continue;
    }
    const usedIndexes = new Set<number>();
    for (const transactionIndex of transactions.values()) {
      if (transactionIndex === undefined) {
        throw new Error(
          'RPC omitted the authoritative transaction index for multiple transactions in one slot.',
        );
      }
      if (usedIndexes.has(transactionIndex)) {
        throw new Error(
          'RPC assigned one transaction index to distinct signatures in the same slot.',
        );
      }
      usedIndexes.add(transactionIndex);
    }
  }
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

function isManifestUnavailable(
  error: unknown,
): error is ManifestVerificationError & { readonly code: 'manifest-unavailable' } {
  return error instanceof ManifestVerificationError && error.code === 'manifest-unavailable';
}

function isDeferrableManifestEvent(event: ProtocolEvent): event is Extract<
  ProtocolEvent,
  {
    readonly type:
      'profile-updated' | 'post-published' | 'community-created' | 'community-membership-changed';
  }
> {
  return (
    event.type === 'profile-updated' ||
    event.type === 'post-published' ||
    event.type === 'community-created' ||
    event.type === 'community-membership-changed'
  );
}

function retryDelay(attempt: number, base: number, maximum: number): number {
  return Math.min(maximum, base * 2 ** Math.min(attempt - 1, 30));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error ? signal.reason : new Error('DroolNet sync aborted.');
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
