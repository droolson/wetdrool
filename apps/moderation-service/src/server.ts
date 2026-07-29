import { pathToFileURL } from 'node:url';

import { parseRateLimitRuntimeConfig } from '@wokesocial/config/rate-limit';
import { createRuntimeRateLimiter, type RuntimeRateLimiterOptions } from '@wokesocial/rate-limit';

import { buildModerationApp } from './app.js';
import { parseModerationConfig } from './config.js';
import { LockedModerationStore } from './locked-store.js';
import { MemoryModerationStore, type ModerationStore } from './store.js';
import { PostgresModerationStore } from './postgres-store.js';
import { ModerationService } from './service.js';

export function createModerationStore(
  config: ReturnType<typeof parseModerationConfig>,
): ModerationStore {
  if (config.databaseUrl !== undefined && config.keyRing !== undefined) {
    return new PostgresModerationStore(config.databaseUrl, config.keyRing);
  }
  if (config.deploymentPolicy === 'nonlocal') {
    return new LockedModerationStore();
  }
  return new MemoryModerationStore();
}

export async function startModerationServer(): Promise<void> {
  const config = parseModerationConfig();
  let logRateLimitBackendError: RateLimitBackendErrorReporter = writeRateLimitBackendError;
  const rateLimiter = await createConfiguredRateLimiter(config.host, (event) => {
    logRateLimitBackendError(event);
  });
  let store: ModerationStore | undefined;
  let app: Awaited<ReturnType<typeof buildModerationApp>> | undefined;
  let maintenancePromise: Promise<void> | undefined;
  let maintenanceTimer: NodeJS.Timeout | undefined;
  let handleSignal: (() => void) | undefined;
  let shutdownPromise: Promise<void> | undefined;
  try {
    const createdStore = createModerationStore(config);
    store = createdStore;
    const service = new ModerationService({
      store: createdStore,
      dangerouslyAllowUnverifiedLocalMode: config.dangerouslyAllowUnverifiedLocalMode,
    });
    app = await buildModerationApp({
      service,
      allowedOrigins: config.allowedOrigins,
      rateLimiter,
      readinessCheck: () => createdStore.readiness(),
      transparencyMinimumCellSize: config.transparencyMinimumCellSize,
      trustedProxyCidrs: config.trustedProxyCidrs,
    });
    const ownedStore = createdStore;
    const ownedApp = app;
    logRateLimitBackendError = (event) => {
      ownedApp.log.error(
        { code: event.code, operation: event.operation, attempts: event.attempts },
        'Rate-limit backend unavailable',
      );
    };
    const maintenance = () => {
      maintenancePromise ??= service
        .runMaintenance(config.maintenance)
        .then((result) => {
          if (result.reviewRequired > 0 || result.actionsExpired > 0 || result.casesRemoved > 0) {
            ownedApp.log.info(result, 'Moderation ledger maintenance completed');
          }
        })
        .finally(() => {
          maintenancePromise = undefined;
        });
      return maintenancePromise;
    };
    if (ownedStore.kind === 'postgres') await maintenance();
    maintenanceTimer = setInterval(() => {
      if (ownedStore.kind !== 'postgres') return;
      void maintenance().catch((error: unknown) => {
        ownedApp.log.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'Moderation ledger maintenance failed',
        );
      });
    }, config.maintenanceIntervalMs);
    maintenanceTimer.unref();

    const shutdown = () => {
      if (maintenanceTimer !== undefined) {
        clearInterval(maintenanceTimer);
        maintenanceTimer = undefined;
      }
      shutdownPromise ??= (async () => {
        const pendingMaintenance = await Promise.allSettled([
          maintenancePromise ?? Promise.resolve(),
        ]);
        const results = [
          ...pendingMaintenance,
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
          throw new AggregateError(failures, 'Moderation service shutdown failed.');
        }
      })();
      return shutdownPromise;
    };
    handleSignal = () => {
      void shutdown().catch((error: unknown) => {
        ownedApp.log.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'Moderation service shutdown failed',
        );
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);
    await ownedApp.listen({ host: config.host, port: config.port });
  } catch (error) {
    if (maintenanceTimer !== undefined) {
      clearInterval(maintenanceTimer);
    }
    if (handleSignal !== undefined) {
      process.removeListener('SIGINT', handleSignal);
      process.removeListener('SIGTERM', handleSignal);
    }
    if (shutdownPromise === undefined) {
      await Promise.allSettled([maintenancePromise ?? Promise.resolve()]);
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
    serviceId: 'moderation-service',
    onBackendError,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startModerationServer();
}
