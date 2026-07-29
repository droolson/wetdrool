import { pathToFileURL } from 'node:url';

import { parseRateLimitRuntimeConfig } from '@wokesocial/config/rate-limit';
import { createRuntimeRateLimiter, type RuntimeRateLimiterOptions } from '@wokesocial/rate-limit';

import { buildAuthApp } from './app.js';
import { parseAuthConfig } from './config.js';
import { MemoryAuthStore } from './memory-store.js';
import { PostgresAuthStore } from './postgres-store.js';
import { cleanupExpiredAuthRecords } from './retention.js';
import { AuthService } from './service.js';

export async function startAuthServer(): Promise<void> {
  const config = parseAuthConfig();
  let logRateLimitBackendError: RateLimitBackendErrorReporter = writeRateLimitBackendError;
  const rateLimiter = await createConfiguredRateLimiter(config.host, (event) => {
    logRateLimitBackendError(event);
  });
  let store: MemoryAuthStore | PostgresAuthStore | undefined;
  let app: Awaited<ReturnType<typeof buildAuthApp>> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let cleanupTimer: NodeJS.Timeout | undefined;
  let handleSignal: (() => void) | undefined;
  let shutdownPromise: Promise<void> | undefined;
  try {
    store =
      config.databaseUrl === undefined
        ? new MemoryAuthStore()
        : new PostgresAuthStore(config.databaseUrl);
    const service = new AuthService({
      store,
      rpName: config.rpName,
      rpId: config.rpId,
      origin: config.origin,
    });
    app = await buildAuthApp({
      rateLimiter,
      service,
      trustedProxyCidrs: config.trustedProxyCidrs,
    });
    const ownedStore = store;
    const ownedApp = app;
    logRateLimitBackendError = (event) => {
      ownedApp.log.error(
        { code: event.code, operation: event.operation, attempts: event.attempts },
        'Rate-limit backend unavailable',
      );
    };
    const cleanup = () => {
      cleanupPromise ??= cleanupExpiredAuthRecords(ownedStore, config.retention)
        .then((result) => {
          if (
            result.pendingAccountsDeleted > 0 ||
            result.ceremoniesDeleted > 0 ||
            result.sessionsDeleted > 0
          ) {
            ownedApp.log.info(result, 'Expired authentication records removed');
          }
        })
        .finally(() => {
          cleanupPromise = undefined;
        });
      return cleanupPromise;
    };
    await cleanup();
    cleanupTimer = setInterval(() => {
      void cleanup().catch((error: unknown) => {
        ownedApp.log.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'Authentication retention cleanup failed',
        );
      });
    }, config.cleanupIntervalMs);
    cleanupTimer.unref();
    const shutdown = () => {
      if (cleanupTimer !== undefined) {
        clearInterval(cleanupTimer);
        cleanupTimer = undefined;
      }
      shutdownPromise ??= (async () => {
        const pendingCleanup = await Promise.allSettled([cleanupPromise ?? Promise.resolve()]);
        const results = [
          ...pendingCleanup,
          ...(await Promise.allSettled([
            ownedApp.close(),
            rateLimiter.close(),
            ownedStore.close(),
          ])),
        ];
        const failures = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason);
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Authentication service shutdown failed.');
        }
      })();
      return shutdownPromise;
    };
    handleSignal = () => {
      void shutdown().catch((error: unknown) => {
        ownedApp.log.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'Authentication service shutdown failed',
        );
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);
    await ownedApp.listen({ host: config.host, port: config.port });
  } catch (error) {
    if (cleanupTimer !== undefined) {
      clearInterval(cleanupTimer);
    }
    if (handleSignal !== undefined) {
      process.removeListener('SIGINT', handleSignal);
      process.removeListener('SIGTERM', handleSignal);
    }
    if (shutdownPromise === undefined) {
      await Promise.allSettled([cleanupPromise ?? Promise.resolve()]);
      await Promise.allSettled([app?.close(), rateLimiter.close(), store?.close()]);
    } else {
      await Promise.allSettled([shutdownPromise]);
    }
    throw error;
  }
}

type RateLimitBackendErrorReporter = NonNullable<RuntimeRateLimiterOptions['onBackendError']>;

function writeRateLimitBackendError(event: Parameters<RateLimitBackendErrorReporter>[0]): void {
  process.stderr.write(
    `${JSON.stringify({
      level: 'error',
      code: event.code,
      operation: event.operation,
      attempts: event.attempts,
      message: 'Rate-limit backend unavailable',
    })}\n`,
  );
}

async function createConfiguredRateLimiter(
  serviceHost: string,
  onBackendError: RateLimitBackendErrorReporter,
) {
  const rateLimitConfig = (() => {
    try {
      return parseRateLimitRuntimeConfig(process.env, { serviceHost });
    } finally {
      Reflect.deleteProperty(process.env, 'RATE_LIMIT_KEY_SECRET');
      Reflect.deleteProperty(process.env, 'REDIS_URL');
    }
  })();
  return createRuntimeRateLimiter({
    config: rateLimitConfig,
    serviceId: 'auth-service',
    onBackendError,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startAuthServer();
}
