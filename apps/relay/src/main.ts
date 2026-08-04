import { pathToFileURL } from 'node:url';

import { parseRateLimitRuntimeConfig } from '@wetdrool/config/rate-limit';
import { createRuntimeRateLimiter, type RuntimeRateLimiterOptions } from '@wetdrool/rate-limit';

import { parseRelayConfig } from './config.js';
import { combineRelayReadinessChecks } from './http-authorizer-client.js';
import { HttpRelayKeyAuthorizer } from './http-key-authorizer.js';
import { HttpRelaySubscriptionAuthorizer } from './http-subscription-authorizer.js';
import { RelayServer } from './relay-server.js';

export async function startRelay(): Promise<void> {
  const config = parseRelayConfig(process.env);
  const rateLimiter = await createConfiguredRateLimiter(config.host, writeRateLimitBackendError);
  let relay: RelayServer | undefined;
  let stopPromise: Promise<void> | undefined;
  let handleSigint: (() => void) | undefined;
  let handleSigterm: (() => void) | undefined;

  try {
    const {
      keyAuthorizer: keyAuthorizerConfig,
      subscriptionAuthorizer: subscriptionAuthorizerConfig,
      ...serverConfig
    } = config;
    const keyAuthorizer =
      keyAuthorizerConfig === undefined
        ? undefined
        : new HttpRelayKeyAuthorizer(keyAuthorizerConfig);
    const subscriptionAuthorizer =
      subscriptionAuthorizerConfig === undefined
        ? undefined
        : new HttpRelaySubscriptionAuthorizer(subscriptionAuthorizerConfig);
    const readinessCheck = combineRelayReadinessChecks([
      keyAuthorizer?.readinessCheck,
      subscriptionAuthorizer?.readinessCheck,
    ]);
    relay = new RelayServer({
      ...serverConfig,
      rateLimiter,
      ...(keyAuthorizer === undefined ? {} : { authorizeKey: keyAuthorizer.authorize }),
      ...(subscriptionAuthorizer === undefined
        ? {}
        : { authorizeSubscription: subscriptionAuthorizer.authorize }),
      ...(readinessCheck === undefined ? {} : { readinessCheck }),
    });
    const ownedRelay = relay;
    const shutdown = (signal: NodeJS.Signals) => {
      stopPromise ??= (async () => {
        process.stderr.write(`[relay] ${signal} received; shutting down.\n`);
        const results = await Promise.allSettled([ownedRelay.stop(), rateLimiter.close()]);
        const failures = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason);
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Relay shutdown failed.');
        }
      })();
      return stopPromise;
    };
    const onSignal = (signal: NodeJS.Signals) => {
      void shutdown(signal).catch(() => {
        process.stderr.write('[relay] shutdown failed.\n');
        process.exitCode = 1;
      });
    };
    handleSigint = () => onSignal('SIGINT');
    handleSigterm = () => onSignal('SIGTERM');
    process.once('SIGINT', handleSigint);
    process.once('SIGTERM', handleSigterm);

    await ownedRelay.start();
  } catch (error) {
    if (handleSigint !== undefined) {
      process.removeListener('SIGINT', handleSigint);
    }
    if (handleSigterm !== undefined) {
      process.removeListener('SIGTERM', handleSigterm);
    }
    await Promise.allSettled([
      relay === undefined ? rateLimiter.close() : (stopPromise ?? relay.stop()),
      rateLimiter.close(),
    ]);
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
    serviceId: 'relay',
    onBackendError,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await startRelay();
  } catch {
    process.stderr.write('[relay] startup failed.\n');
    process.exitCode = 1;
  }
}
