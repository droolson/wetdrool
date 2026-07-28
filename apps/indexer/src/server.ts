import { LocalContentAddressedStorage } from '@wokesocial/storage';

import { buildIndexerApp } from './app.js';
import { readIndexerConfig } from './config.js';
import { ManifestVerifier } from './manifest-verifier.js';
import { migrate } from './migrate.js';
import { OpenIndexer } from './indexer.js';
import { PostgresProjectionStore } from './postgres-projection.js';
import { ProjectionRootKeyAuthorizer } from './projection-key-authorizer.js';
import { SolanaEventMaterializer } from './solana-materializer.js';
import { FailoverSolanaRpc } from './solana-rpc.js';
import { SolanaSyncWorker } from './solana-sync.js';

const config = readIndexerConfig();
await migrate(config.databaseUrl);

const projection = new PostgresProjectionStore(config.databaseUrl);
const storage = new LocalContentAddressedStorage({
  rootDirectory: config.contentStoragePath,
});

const verifier = new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection));
const indexer = new OpenIndexer(projection, verifier);

const app = await buildIndexerApp({
  projection,
  allowedOrigins: config.allowedOrigins,
  ...(config.sync === undefined ? {} : { defaultNetworkId: config.sync.networkId }),
});

const syncAbort = new AbortController();
let syncPromise: Promise<void> | undefined;
let syncWorker: SolanaSyncWorker | undefined;
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
  await app.close();
  await projection.close();
  process.exitCode = 0;
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
if (syncWorker !== undefined) {
  syncPromise = syncWorker.run(syncAbort.signal).catch((error: unknown) => {
    app.log.error({ error }, 'WokeNet ingestion stopped unexpectedly');
    process.exitCode = 1;
  });
}
