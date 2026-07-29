import { performance } from 'node:perf_hooks';

export type IndexerReadinessStatus =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      reason: 'sync-failed' | 'sync-stale' | 'sync-starting';
    }>;

export interface IndexerRuntimeReadinessOptions {
  readonly sync?: Readonly<{
    staleAfterMilliseconds: number;
  }>;
  readonly now?: () => number;
}

export class IndexerRuntimeReadiness {
  readonly #now: () => number;
  readonly #syncStaleAfterMilliseconds: number | undefined;
  #lastSuccessfulSyncAt: number | undefined;
  #syncFailed = false;

  constructor(options: IndexerRuntimeReadinessOptions = {}) {
    this.#now = options.now ?? (() => performance.now());
    this.#syncStaleAfterMilliseconds = options.sync?.staleAfterMilliseconds;
    if (
      this.#syncStaleAfterMilliseconds !== undefined &&
      (!Number.isSafeInteger(this.#syncStaleAfterMilliseconds) ||
        this.#syncStaleAfterMilliseconds <= 0)
    ) {
      throw new TypeError('Sync staleness threshold must be a positive safe integer.');
    }
  }

  markSyncSucceeded(): void {
    if (!this.#syncFailed && this.#syncStaleAfterMilliseconds !== undefined) {
      this.#lastSuccessfulSyncAt = this.#now();
    }
  }

  markSyncFailed(): void {
    if (this.#syncStaleAfterMilliseconds !== undefined) {
      this.#syncFailed = true;
    }
  }

  status(): IndexerReadinessStatus {
    const staleAfter = this.#syncStaleAfterMilliseconds;
    if (staleAfter === undefined) {
      return { ok: true };
    }
    if (this.#syncFailed) {
      return { ok: false, reason: 'sync-failed' };
    }
    if (this.#lastSuccessfulSyncAt === undefined) {
      return { ok: false, reason: 'sync-starting' };
    }
    if (this.#now() - this.#lastSuccessfulSyncAt >= staleAfter) {
      return { ok: false, reason: 'sync-stale' };
    }
    return { ok: true };
  }
}

export interface SyncWorkerSupervisionOptions {
  readonly abortController: AbortController;
  readonly close: () => Promise<void>;
  readonly onFailure?: (error: unknown) => void;
  readonly readiness: IndexerRuntimeReadiness;
  readonly run: () => Promise<void>;
}

/**
 * A sync worker is expected to run until its shared abort signal is set.
 * Unexpected rejection or return is fatal: readiness fails before the HTTP
 * listener and database pool are closed.
 */
export async function superviseSyncWorker(options: SyncWorkerSupervisionOptions): Promise<void> {
  let failure: unknown;
  try {
    await options.run();
    if (!options.abortController.signal.aborted) {
      failure = new Error('WokeNet ingestion stopped without a shutdown request.');
    }
  } catch (error) {
    if (options.abortController.signal.aborted) {
      return;
    }
    failure = error;
  }

  if (failure === undefined) {
    return;
  }

  options.readiness.markSyncFailed();
  try {
    options.onFailure?.(failure);
  } finally {
    options.abortController.abort(failure);
    await options.close();
  }
}
