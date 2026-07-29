import { describe, expect, it } from 'vitest';

import {
  buildIndexerApp,
  IndexerRuntimeReadiness,
  MemoryProjectionStore,
  superviseSyncWorker,
} from '../src/index.js';

describe('indexer runtime readiness', () => {
  it('fails readiness while sync starts, after it becomes stale, and after a fatal failure', async () => {
    let now = 1_000;
    const readiness = new IndexerRuntimeReadiness({
      sync: { staleAfterMilliseconds: 500 },
      now: () => now,
    });
    const projection = new MemoryProjectionStore();
    const app = await buildIndexerApp({
      projection,
      runtimeReadiness: readiness,
      logger: false,
    });
    expect(app.initialConfig).toMatchObject({
      connectionTimeout: 10_000,
      keepAliveTimeout: 5_000,
      maxRequestsPerSocket: 1_000,
      requestTimeout: 15_000,
    });
    expect(app.server.headersTimeout).toBe(10_000);
    expect(app.server.maxHeadersCount).toBe(64);

    try {
      const starting = await app.inject({ method: 'GET', url: '/readyz' });
      expect(starting.statusCode).toBe(503);
      expect(starting.json()).toEqual({ ok: false, reason: 'sync-starting' });

      readiness.markSyncSucceeded();
      const current = await app.inject({ method: 'GET', url: '/readyz' });
      expect(current.statusCode).toBe(200);
      expect(current.json()).toEqual({ ok: true });

      now += 500;
      const stale = await app.inject({ method: 'GET', url: '/readyz' });
      expect(stale.statusCode).toBe(503);
      expect(stale.json()).toEqual({ ok: false, reason: 'sync-stale' });
      const live = await app.inject({ method: 'GET', url: '/healthz' });
      expect(live.statusCode).toBe(200);

      readiness.markSyncFailed();
      const failed = await app.inject({ method: 'GET', url: '/readyz' });
      expect(failed.statusCode).toBe(503);
      expect(failed.json()).toEqual({ ok: false, reason: 'sync-failed' });
    } finally {
      await app.close();
      await projection.close();
    }
  });

  it('marks a rejected worker fatal before closing the ready listener', async () => {
    const readiness = new IndexerRuntimeReadiness({
      sync: { staleAfterMilliseconds: 10_000 },
    });
    readiness.markSyncSucceeded();
    const projection = new MemoryProjectionStore();
    const app = await buildIndexerApp({
      projection,
      runtimeReadiness: readiness,
      logger: false,
    });
    const abortController = new AbortController();
    const workerFailure = new Error('unrecoverable worker failure');
    let statusAtClose: ReturnType<IndexerRuntimeReadiness['status']> | undefined;
    let reportedFailure: unknown;

    await app.listen({ host: '127.0.0.1', port: 0 });
    expect(app.server.listening).toBe(true);

    try {
      await superviseSyncWorker({
        abortController,
        readiness,
        run: () => Promise.reject(workerFailure),
        onFailure: (error) => {
          reportedFailure = error;
        },
        close: async () => {
          statusAtClose = readiness.status();
          await app.close();
        },
      });

      expect(reportedFailure).toBe(workerFailure);
      expect(statusAtClose).toEqual({ ok: false, reason: 'sync-failed' });
      expect(abortController.signal.aborted).toBe(true);
      expect(app.server.listening).toBe(false);
    } finally {
      if (app.server.listening) {
        await app.close();
      }
      await projection.close();
    }
  });

  it('treats an unexpected clean worker return as fatal', async () => {
    const readiness = new IndexerRuntimeReadiness({
      sync: { staleAfterMilliseconds: 10_000 },
    });
    const abortController = new AbortController();
    let closed = false;

    await superviseSyncWorker({
      abortController,
      readiness,
      run: () => Promise.resolve(),
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    });

    expect(readiness.status()).toEqual({ ok: false, reason: 'sync-failed' });
    expect(abortController.signal.aborted).toBe(true);
    expect(closed).toBe(true);
  });
});
