import { COMPOSER_DRAFT_STORAGE_KEY, type DraftStorage } from './composer-draft';
import { POST_PUBLICATION_INTENT_STORAGE_KEY } from './post-publication-intent';

export const LOCALNET_PUBLICATION_LOCK_NAME = 'wetdrool:localnet-publication:v1';

export type BrowserPublicationLockErrorCode =
  'aborted' | 'busy' | 'state-changed' | 'storage-unavailable' | 'unavailable';

export class BrowserPublicationLockError extends Error {
  override readonly name = 'BrowserPublicationLockError';

  constructor(
    readonly code: BrowserPublicationLockErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface BrowserPublicationLock {
  readonly name: string;
  readonly mode: 'exclusive';
}

export interface BrowserPublicationLockManager {
  request<Result>(
    name: string,
    options: {
      readonly ifAvailable: true;
      readonly mode: 'exclusive';
    },
    callback: (lock: BrowserPublicationLock | null) => Result | PromiseLike<Result>,
  ): Promise<Result>;
}

export interface BrowserPublicationLockOptions {
  readonly locks?: BrowserPublicationLockManager | null;
  readonly signal?: AbortSignal;
}

interface PublicationStorageSnapshot {
  readonly draft: string | null;
  readonly intent: string | null;
}

/**
 * Runs one publication/cleanup sequence under a fail-closed, cross-tab Web
 * Lock. The exact saved draft and intent are re-read after acquiring the lock,
 * so a stale click cannot operate after another tab changes or clears them.
 */
export async function withExclusiveLocalnetPublicationLock<Result>(
  storage: Pick<DraftStorage, 'getItem'>,
  operation: () => Result | Promise<Result>,
  options: BrowserPublicationLockOptions = {},
): Promise<Result> {
  if (
    storage === null ||
    typeof storage !== 'object' ||
    typeof storage.getItem !== 'function' ||
    typeof operation !== 'function'
  ) {
    throw lockError(
      'storage-unavailable',
      'Publication locking requires readable browser storage.',
    );
  }
  assertActive(options.signal);
  const before = readSnapshot(storage);
  const manager = options.locks === undefined ? browserLockManager() : options.locks;
  if (manager === null) {
    throw lockError(
      'unavailable',
      'This browser does not expose the Web Locks boundary required for publication.',
    );
  }

  let operationRejected = false;
  let operationError: unknown;
  try {
    return await manager.request(
      LOCALNET_PUBLICATION_LOCK_NAME,
      {
        ifAvailable: true,
        mode: 'exclusive',
      },
      async (lock) => {
        assertActive(options.signal);
        if (
          lock === null ||
          lock.name !== LOCALNET_PUBLICATION_LOCK_NAME ||
          lock.mode !== 'exclusive'
        ) {
          throw lockError(
            'busy',
            'Another WetDrool tab is already publishing this browser state.',
          );
        }
        const after = readSnapshot(storage);
        if (after.draft !== before.draft || after.intent !== before.intent) {
          throw lockError(
            'state-changed',
            'The saved draft or publication intent changed before the exclusive lock was acquired.',
          );
        }
        try {
          return await operation();
        } catch (error) {
          operationRejected = true;
          operationError = error;
          throw error;
        }
      },
    );
  } catch (error) {
    if (operationRejected) throw operationError;
    if (error instanceof BrowserPublicationLockError) throw error;
    if (
      options.signal?.aborted === true ||
      (error instanceof DOMException && error.name === 'AbortError')
    ) {
      throw lockError('aborted', 'Publication lock acquisition was cancelled.', error);
    }
    throw lockError(
      'unavailable',
      'The browser publication lock failed before the operation could run.',
      error,
    );
  }
}

function browserLockManager(): BrowserPublicationLockManager | null {
  if (
    typeof navigator === 'undefined' ||
    navigator.locks === undefined ||
    typeof navigator.locks.request !== 'function'
  ) {
    return null;
  }
  return navigator.locks as unknown as BrowserPublicationLockManager;
}

function readSnapshot(storage: Pick<DraftStorage, 'getItem'>): PublicationStorageSnapshot {
  try {
    return {
      draft: storage.getItem(COMPOSER_DRAFT_STORAGE_KEY),
      intent: storage.getItem(POST_PUBLICATION_INTENT_STORAGE_KEY),
    };
  } catch (error) {
    throw lockError(
      'storage-unavailable',
      'Browser storage could not be read at the publication lock boundary.',
      error,
    );
  }
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw lockError('aborted', 'Publication lock acquisition was cancelled.');
  }
}

function lockError(
  code: BrowserPublicationLockErrorCode,
  message: string,
  cause?: unknown,
): BrowserPublicationLockError {
  return new BrowserPublicationLockError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}
