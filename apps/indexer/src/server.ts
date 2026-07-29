import { pathToFileURL } from 'node:url';

import { parseRateLimitRuntimeConfig } from '@wokesocial/config/rate-limit';
import { createRuntimeRateLimiter, type RuntimeRateLimiterOptions } from '@wokesocial/rate-limit';
import { LocalContentAddressedStorage } from '@wokesocial/storage';

import { buildIndexerApp } from './app.js';
import { readIndexerConfig } from './config.js';
import { OpenIndexer } from './indexer.js';
import { ManifestVerifier } from './manifest-verifier.js';
import { PostgresProjectionStore } from './postgres-projection.js';
import { ProjectionRootKeyAuthorizer } from './projection-key-authorizer.js';
import { IndexerRuntimeReadiness, superviseSyncWorker } from './runtime-readiness.js';
import { assertReadableContentStorage } from './runtime-storage.js';
import { SolanaEventMaterializer } from './solana-materializer.js';
import { FailoverSolanaRpc } from './solana-rpc.js';
import { SolanaSyncWorker } from './solana-sync.js';

export async function startIndexerServer(): Promise<void> {
  const config = readIndexerConfig();
  await assertReadableContentStorage(config.contentStoragePath);
  let logRateLimitBackendError: RateLimitBackendErrorReporter = writeRateLimitBackendError;
  const rateLimiter = await createConfiguredRateLimiter(config.host, (event) => {
    logRateLimitBackendError(event);
  });
  const syncAbort = new AbortController();
  let projection: PostgresProjectionStore | undefined;
  let app: Awaited<ReturnType<typeof buildIndexerApp>> | undefined;
  let syncPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let shutdownPromise: Promise<void> | undefined;
  let handleSigint: (() => void) | undefined;
  let handleSigterm: (() => void) | undefined;

  try {
    projection = new PostgresProjectionStore(config.databaseUrl);
    const storage = new LocalContentAddressedStorage({
      rootDirectory: config.contentStoragePath,
    });
    const runtimeReadiness = new IndexerRuntimeReadiness(
      config.sync === undefined
        ? {}
        : {
            sync: {
              staleAfterMilliseconds: config.sync.staleAfterMilliseconds,
            },
          },
    );

    const verifier = new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection), {
      profileSchemaV2ActivationSlot: config.profileSchemaV2ActivationSlot,
    });
    const indexer = new OpenIndexer(projection, verifier);

    app = await buildIndexerApp({
      projection,
      allowedOrigins: config.allowedOrigins,
      ...(config.sync === undefined ? {} : { defaultNetworkId: config.sync.networkId }),
      rateLimiter,
      runtimeReadiness,
      trustedProxyCidrs: config.trustedProxyCidrs,
    });
    const ownedApp = app;
    const ownedProjection = projection;
    logRateLimitBackendError = (event) => {
      ownedApp.log.error(
        { code: event.code, operation: event.operation, attempts: event.attempts },
        'Rate-limit backend unavailable',
      );
    };
    const closeRuntime = () => {
      closePromise ??= (async () => {
        const results = await Promise.allSettled([
          ownedApp.close(),
          rateLimiter.close(),
          ownedProjection.close(),
        ]);
        const failures = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason);
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Indexer runtime shutdown failed.');
        }
      })();
      return closePromise;
    };

    let syncWorker: SolanaSyncWorker | undefined;
    if (config.sync === undefined) {
      ownedApp.log.warn(
        'Solana ingestion is disabled; set both INDEXER_NETWORK_ID and NEXT_PUBLIC_PROGRAM_ID to enable the finalized replay worker',
      );
    } else {
      const genesisHash = config.sync.networkId.split(':').at(-2);
      if (genesisHash === undefined) {
        throw new Error('Validated indexer network ID has no genesis hash.');
      }
      syncWorker = new SolanaSyncWorker({
        rpc: FailoverSolanaRpc.fromUrls(config.sync.rpcUrls, genesisHash, config.sync.programId),
        indexer,
        projection: ownedProjection,
        materializer: new SolanaEventMaterializer(storage, ownedProjection),
        networkId: config.sync.networkId,
        programId: config.sync.programId,
        deploymentSlot: config.sync.deploymentSlot,
        batchSize: config.sync.batchSize,
        pollIntervalMilliseconds: config.sync.pollIntervalMilliseconds,
        retryAttempts: config.sync.retryAttempts,
        retryBaseMilliseconds: config.sync.retryBaseMilliseconds,
        retryMaximumMilliseconds: config.sync.retryMaximumMilliseconds,
        onPollSucceeded: (result) => {
          if (result.checkpointAdvanced) {
            runtimeReadiness.markSyncSucceeded();
          }
        },
        logger: {
          debug: (context, message) => ownedApp.log.debug(context, message),
          info: (context, message) => ownedApp.log.info(context, message),
          warn: (context, message) => ownedApp.log.warn(context, message),
          error: (context, message) => ownedApp.log.error(context, message),
        },
      });
      await syncWorker.initialize();
    }

    const shutdown = (signal: string) => {
      shutdownPromise ??= (async () => {
        ownedApp.log.info({ signal }, 'indexer shutdown requested');
        syncAbort.abort(new Error(`Indexer shutdown requested by ${signal}.`));
        const results = [
          ...(await Promise.allSettled([syncPromise ?? Promise.resolve()])),
          ...(await Promise.allSettled([closeRuntime()])),
        ];
        const failures = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason);
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Indexer shutdown failed.');
        }
        if (process.exitCode !== 1) {
          process.exitCode = 0;
        }
      })();
      return shutdownPromise;
    };
    const onSignal = (signal: string) => {
      void shutdown(signal).catch((error: unknown) => {
        ownedApp.log.error({ error }, 'indexer shutdown failed');
        process.exitCode = 1;
      });
    };
    handleSigint = () => onSignal('SIGINT');
    handleSigterm = () => onSignal('SIGTERM');
    process.once('SIGINT', handleSigint);
    process.once('SIGTERM', handleSigterm);

    await ownedApp.listen({ host: config.host, port: config.port });
    if (syncWorker !== undefined) {
      const ownedSyncWorker = syncWorker;
      syncPromise = superviseSyncWorker({
        abortController: syncAbort,
        close: closeRuntime,
        readiness: runtimeReadiness,
        run: () => ownedSyncWorker.run(syncAbort.signal),
        onFailure: (error) => {
          ownedApp.log.error({ error }, 'WokeNet ingestion stopped unexpectedly');
          process.exitCode = 1;
        },
      });
      void syncPromise.catch((error: unknown) => {
        runtimeReadiness.markSyncFailed();
        ownedApp.log.error({ error }, 'indexer failed to close after WokeNet ingestion stopped');
        process.exitCode = 1;
      });
    }
  } catch (error) {
    syncAbort.abort(error);
    if (handleSigint !== undefined) {
      process.removeListener('SIGINT', handleSigint);
    }
    if (handleSigterm !== undefined) {
      process.removeListener('SIGTERM', handleSigterm);
    }
    if (shutdownPromise === undefined) {
      await Promise.allSettled([syncPromise ?? Promise.resolve()]);
      if (closePromise === undefined) {
        await Promise.allSettled([app?.close(), rateLimiter.close(), projection?.close()]);
      } else {
        await Promise.allSettled([closePromise]);
      }
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
    serviceId: 'indexer',
    onBackendError,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startIndexerServer();
}
