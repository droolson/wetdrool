import { pathToFileURL } from 'node:url';

import { buildAuthApp } from './app.js';
import { parseAuthConfig } from './config.js';
import { MemoryAuthStore } from './memory-store.js';
import { PostgresAuthStore } from './postgres-store.js';
import { cleanupExpiredAuthRecords } from './retention.js';
import { AuthService } from './service.js';

export async function startAuthServer(): Promise<void> {
  const config = parseAuthConfig();
  const store =
    config.databaseUrl === undefined
      ? new MemoryAuthStore()
      : new PostgresAuthStore(config.databaseUrl);
  const service = new AuthService({
    store,
    rpName: config.rpName,
    rpId: config.rpId,
    origin: config.origin,
  });
  const app = await buildAuthApp({
    service,
    trustedProxyCidrs: config.trustedProxyCidrs,
  });
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => {
    cleanupPromise ??= cleanupExpiredAuthRecords(store, config.retention)
      .then((result) => {
        if (
          result.pendingAccountsDeleted > 0 ||
          result.ceremoniesDeleted > 0 ||
          result.sessionsDeleted > 0
        ) {
          app.log.info(result, 'Expired authentication records removed');
        }
      })
      .finally(() => {
        cleanupPromise = undefined;
      });
    return cleanupPromise;
  };
  await cleanup();
  const cleanupTimer = setInterval(() => {
    void cleanup().catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Authentication retention cleanup failed',
      );
    });
  }, config.cleanupIntervalMs);
  cleanupTimer.unref();
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    clearInterval(cleanupTimer);
    shutdownPromise ??= (async () => {
      await cleanupPromise;
      const results = await Promise.allSettled([app.close(), store.close()]);
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Authentication service shutdown failed.');
      }
    })();
    return shutdownPromise;
  };
  const handleSignal = () => {
    void shutdown().catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Authentication service shutdown failed',
      );
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
  await app.listen({ host: config.host, port: config.port });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startAuthServer();
}
