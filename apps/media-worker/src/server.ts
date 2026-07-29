import { pathToFileURL } from 'node:url';

import { LocalContentAddressedStorage } from '@wokesocial/storage';
import { parseRateLimitRuntimeConfig } from '@wokesocial/config/rate-limit';
import { createRuntimeRateLimiter, type RuntimeRateLimiterOptions } from '@wokesocial/rate-limit';

import { buildMediaWorkerApp } from './app.js';
import { ClamdScanner } from './clamd-scanner.js';
import { parseMediaWorkerConfig } from './config.js';
import { maximumUploadBytes } from './schemas.js';
import { MediaWorkerService } from './service.js';
import { StaticBearerAuthorization } from './static-bearer-authorization.js';

export async function startMediaWorker(): Promise<void> {
  const config = parseMediaWorkerConfig();
  const authorization = new StaticBearerAuthorization(config.staticBearerToken);
  delete process.env.MEDIA_WORKER_STATIC_BEARER_TOKEN;
  const scanner = new ClamdScanner({
    host: config.clamdHost,
    port: config.clamdPort,
    connectTimeoutMilliseconds: config.clamdConnectTimeoutMilliseconds,
    scanTimeoutMilliseconds: config.clamdScanTimeoutMilliseconds,
    streamMaximumBytes: config.clamdStreamMaximumBytes,
    maximumDatabaseAgeMilliseconds: config.clamdMaximumDatabaseAgeMilliseconds,
  });
  if (!(await scanner.healthCheck())) {
    throw new Error('The configured private clamd scanner is unavailable.');
  }
  let logRateLimitBackendError: RateLimitBackendErrorReporter = writeRateLimitBackendError;
  const rateLimiter = await createConfiguredRateLimiter(config.host, (event) => {
    logRateLimitBackendError(event);
  });
  let app: Awaited<ReturnType<typeof buildMediaWorkerApp>> | undefined;
  let cleanupTimer: NodeJS.Timeout | undefined;
  let shutdownPromise: Promise<void> | undefined;
  let handleSigint: (() => void) | undefined;
  let handleSigterm: (() => void) | undefined;
  try {
    const service = new MediaWorkerService({
      stagingRoot: config.stagingRoot,
      temporaryRoot: config.temporaryRoot,
      scanner,
      scanTimeoutMilliseconds: config.clamdScanTimeoutMilliseconds + 1_000,
      storage: new LocalContentAddressedStorage({
        rootDirectory: config.storageRoot,
        maximumObjectBytes: maximumUploadBytes,
      }),
    });
    app = await buildMediaWorkerApp({
      service,
      allowedOrigins: config.allowedOrigins,
      authorizeRequest: authorization.authorize,
      rateLimiter,
      trustedProxyCidrs: config.trustedProxyCidrs,
    });
    const ownedApp = app;
    logRateLimitBackendError = (event) => {
      ownedApp.log.error(
        { code: event.code, operation: event.operation, attempts: event.attempts },
        'Rate-limit backend unavailable',
      );
    };
    cleanupTimer = setInterval(() => {
      void service.cleanupExpired(100).catch((error: unknown) => {
        ownedApp.log.error(safeErrorFields(error), 'media staging cleanup failed');
      });
    }, config.cleanupIntervalMilliseconds);
    cleanupTimer.unref();

    const shutdown = (signal: string) => {
      if (cleanupTimer !== undefined) {
        clearInterval(cleanupTimer);
        cleanupTimer = undefined;
      }
      shutdownPromise ??= (async () => {
        ownedApp.log.info({ signal }, 'media worker shutting down');
        const results = await Promise.allSettled([ownedApp.close(), rateLimiter.close()]);
        const failures = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason);
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Media worker shutdown failed.');
        }
        process.exitCode = 0;
      })();
      return shutdownPromise;
    };
    const onSignal = (signal: string) => {
      void shutdown(signal).catch((error: unknown) => {
        ownedApp.log.error(safeErrorFields(error), 'media worker shutdown failed');
        process.exitCode = 1;
      });
    };
    handleSigint = () => onSignal('SIGINT');
    handleSigterm = () => onSignal('SIGTERM');
    process.once('SIGINT', handleSigint);
    process.once('SIGTERM', handleSigterm);

    await ownedApp.listen({ host: config.host, port: config.port });
  } catch (error) {
    if (cleanupTimer !== undefined) {
      clearInterval(cleanupTimer);
    }
    if (handleSigint !== undefined) {
      process.removeListener('SIGINT', handleSigint);
    }
    if (handleSigterm !== undefined) {
      process.removeListener('SIGTERM', handleSigterm);
    }
    if (shutdownPromise === undefined) {
      await Promise.allSettled([app?.close(), rateLimiter.close()]);
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
    serviceId: 'media-worker',
    onBackendError,
  });
}

function safeErrorFields(error: unknown): {
  readonly errorName: string;
  readonly errorCode: string;
} {
  return {
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorCode:
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code.slice(0, 80)
        : 'unknown',
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await startMediaWorker();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        level: 'error',
        ...safeErrorFields(error),
        message: 'media worker startup failed',
      })}\n`,
    );
    process.exitCode = 1;
  }
}
