import { LocalContentAddressedStorage } from '@wokesocial/storage';

import { buildIndexerApp } from './app.js';
import { readIndexerConfig } from './config.js';
import { ManifestVerifier } from './manifest-verifier.js';
import { OpenIndexer } from './indexer.js';
import { PostgresProjectionStore } from './postgres-projection.js';
import { ProjectionRootKeyAuthorizer } from './projection-key-authorizer.js';
import { IndexerRuntimeReadiness, superviseSyncWorker } from './runtime-readiness.js';
import { assertReadableContentStorage } from './runtime-storage.js';
import { SolanaEventMaterializer } from './solana-materializer.js';
import { FailoverSolanaRpc } from './solana-rpc.js';
import { SolanaSyncWorker } from './solana-sync.js';

const config = readIndexerConfig();
await assertReadableContentStorage(config.contentStoragePath);

const projection = new PostgresProjectionStore(config.databaseUrl);
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

const app = await buildIndexerApp({
  projection,
  allowedOrigins: config.allowedOrigins,
  ...(config.sync === undefined ? {} : { defaultNetworkId: config.sync.networkId }),
  runtimeReadiness,
  trustedProxyCidrs: config.trustedProxyCidrs,
});

const syncAbort = new AbortController();
let syncPromise: Promise<void> | undefined;
let syncWorker: SolanaSyncWorker | undefined;
let closePromise: Promise<void> | undefined;
const closeRuntime = (): Promise<void> => {
  closePromise ??= app.close().finally(async () => {
    await projection.close();
  });
  return closePromise;
};
if (config.sync === undefined) {
  app.log.warn(
    'WokeNet ingestion is disabled; set both INDEXER_NETWORK_ID and NEXT_PUBLIC_PROGRAM_ID to enable the finalized replay worker',
  );
} else {
  const genesisHash = config.sync.networkId.split(':').at(-2);
  if (genesisHash === undefined) {
    throw new Error('Validated indexer network ID has no genesis hash.');
  }
  syncWorker = new SolanaSyncWorker({
    rpc: FailoverSolanaRpc.fromUrls(config.sync.rpcUrls, genesisHash, config.sync.programId),
    indexer,
    projection,
    materializer: new SolanaEventMaterializer(storage, projection),
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
      debug: (context, message) => app.log.debug(context, message),
      info: (context, message) => app.log.info(context, message),
      warn: (context, message) => app.log.warn(context, message),
      error: (context, message) => app.log.error(context, message),
    },
  });
  await syncWorker.initialize();
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'indexer shutdown requested');
  syncAbort.abort(new Error(`Indexer shutdown requested by ${signal}.`));
  await syncPromise;
  await closeRuntime();
  if (process.exitCode !== 1) {
    process.exitCode = 0;
  }
};
process.once('SIGINT', () => {
  void shutdown('SIGINT').catch((error: unknown) => {
    app.log.error({ error }, 'indexer shutdown failed');
    process.exitCode = 1;
  });
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM').catch((error: unknown) => {
    app.log.error({ error }, 'indexer shutdown failed');
    process.exitCode = 1;
  });
});

await app.listen({ host: config.host, port: config.port });
if (syncWorker !== undefined) {
  syncPromise = superviseSyncWorker({
    abortController: syncAbort,
    close: closeRuntime,
    readiness: runtimeReadiness,
    run: () => syncWorker.run(syncAbort.signal),
    onFailure: (error) => {
      app.log.error({ error }, 'WokeNet ingestion stopped unexpectedly');
      process.exitCode = 1;
    },
  });
  void syncPromise.catch((error: unknown) => {
    runtimeReadiness.markSyncFailed();
    app.log.error({ error }, 'indexer failed to close after WokeNet ingestion stopped');
    process.exitCode = 1;
  });
}
