import { pathToFileURL } from 'node:url';

import { parseRateLimitRuntimeConfig } from '@wokesocial/config/rate-limit';
import { createRuntimeRateLimiter, type RuntimeRateLimiterOptions } from '@wokesocial/rate-limit';

import { buildFeedServiceApp } from './app.js';
import { parseFeedServiceConfig } from './config.js';

export async function startFeedService(): Promise<void> {
  const config = parseFeedServiceConfig(process.env);
  let logRateLimitBackendError: RateLimitBackendErrorReporter = writeRateLimitBackendError;
  const rateLimiter = await createConfiguredRateLimiter(config.host, (event) => {
    logRateLimitBackendError(event);
  });
  let app: Awaited<ReturnType<typeof buildFeedServiceApp>> | undefined;
  let shutdownPromise: Promise<void> | undefined;
  let handleSigint: (() => void) | undefined;
  let handleSigterm: (() => void) | undefined;

  try {
    app = await buildFeedServiceApp({
      allowedOrigins: config.allowedOrigins,
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
    const shutdown = (signal: NodeJS.Signals) => {
      shutdownPromise ??= (async () => {
        ownedApp.log.info({ signal }, 'Stopping feed service');
        const results = await Promise.allSettled([ownedApp.close(), rateLimiter.close()]);
        const failures = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason);
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Feed service shutdown failed.');
        }
      })();
      return shutdownPromise;
    };
    const handleSignal = (signal: NodeJS.Signals) => {
      void shutdown(signal).catch((error: unknown) => {
        ownedApp.log.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'Feed service shutdown failed',
        );
        process.exitCode = 1;
      });
    };
    handleSigint = () => handleSignal('SIGINT');
    handleSigterm = () => handleSignal('SIGTERM');
    process.once('SIGINT', handleSigint);
    process.once('SIGTERM', handleSigterm);

    await ownedApp.listen({ host: config.host, port: config.port });
  } catch (error) {
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
    serviceId: 'feed-service',
    onBackendError,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await startFeedService();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        level: 'fatal',
        errorName: error instanceof Error ? error.name : 'UnknownError',
        message: 'Feed service failed to start',
      })}\n`,
    );
    process.exitCode = 1;
  }
}
