import { describe, expect, it, vi } from 'vitest';

import {
  BrowserPublicationLockError,
  LOCALNET_PUBLICATION_LOCK_NAME,
  withExclusiveLocalnetPublicationLock,
  type BrowserPublicationLockManager,
} from '../lib/browser-publication-lock';
import { COMPOSER_DRAFT_STORAGE_KEY } from '../lib/composer-draft';
import { POST_PUBLICATION_INTENT_STORAGE_KEY } from '../lib/post-publication-intent';

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
}

function availableManager(beforeCallback?: () => void): BrowserPublicationLockManager {
  return {
    async request(name, options, callback) {
      expect(name).toBe(LOCALNET_PUBLICATION_LOCK_NAME);
      expect(options).toMatchObject({
        ifAvailable: true,
        mode: 'exclusive',
      });
      expect(options).not.toHaveProperty('signal');
      beforeCallback?.();
      return callback({ mode: 'exclusive', name });
    },
  };
}

describe('exclusive browser publication lock', () => {
  it('runs only after the exclusive lock rechecks the exact saved state', async () => {
    const storage = new MemoryStorage();
    storage.values.set(COMPOSER_DRAFT_STORAGE_KEY, '{"draft":1}');
    storage.values.set(POST_PUBLICATION_INTENT_STORAGE_KEY, '{"intent":1}');
    const operation = vi.fn(async () => 'complete');

    await expect(
      withExclusiveLocalnetPublicationLock(storage, operation, {
        locks: availableManager(),
      }),
    ).resolves.toBe('complete');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['draft', COMPOSER_DRAFT_STORAGE_KEY],
    ['intent', POST_PUBLICATION_INTENT_STORAGE_KEY],
  ])('rejects a stale tab when the saved %s changes before acquisition', async (_label, key) => {
    const storage = new MemoryStorage();
    storage.values.set(key, 'before');
    const operation = vi.fn();
    await expect(
      withExclusiveLocalnetPublicationLock(storage, operation, {
        locks: availableManager(() => storage.values.set(key, 'after')),
      }),
    ).rejects.toMatchObject({ code: 'state-changed' });
    expect(operation).not.toHaveBeenCalled();
  });

  it('rejects immediately when another tab holds the publication lock', async () => {
    const manager: BrowserPublicationLockManager = {
      async request(_name, _options, callback) {
        return callback(null);
      },
    };
    const operation = vi.fn();
    await expect(
      withExclusiveLocalnetPublicationLock(new MemoryStorage(), operation, {
        locks: manager,
      }),
    ).rejects.toMatchObject({ code: 'busy' });
    expect(operation).not.toHaveBeenCalled();
  });

  it('fails closed without Web Locks and on cancellation', async () => {
    await expect(
      withExclusiveLocalnetPublicationLock(new MemoryStorage(), vi.fn(), {
        locks: null,
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });

    const controller = new AbortController();
    controller.abort();
    await expect(
      withExclusiveLocalnetPublicationLock(new MemoryStorage(), vi.fn(), {
        locks: availableManager(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });

  it('does not combine signal with ifAvailable in the Web Locks request', async () => {
    const controller = new AbortController();
    const manager: BrowserPublicationLockManager = {
      async request(name, options, callback) {
        if ('signal' in options && options.ifAvailable) {
          throw new DOMException(
            "The 'signal' and 'ifAvailable' options cannot be used together.",
            'NotSupportedError',
          );
        }
        return callback({ mode: 'exclusive', name });
      },
    };

    await expect(
      withExclusiveLocalnetPublicationLock(new MemoryStorage(), async () => 'complete', {
        locks: manager,
        signal: controller.signal,
      }),
    ).resolves.toBe('complete');
  });

  it('preserves callback operation failures without relabeling them as lock failures', async () => {
    const operationError = new Error('faucet finalization failed');

    await expect(
      withExclusiveLocalnetPublicationLock(
        new MemoryStorage(),
        async () => {
          throw operationError;
        },
        { locks: availableManager() },
      ),
    ).rejects.toBe(operationError);
  });

  it('preserves typed lock errors for UI-safe handling', () => {
    expect(new BrowserPublicationLockError('busy', 'busy')).toMatchObject({
      code: 'busy',
      name: 'BrowserPublicationLockError',
    });
  });
});
