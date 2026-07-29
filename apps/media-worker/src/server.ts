import { LocalContentAddressedStorage } from '@wokesocial/storage';

import { buildMediaWorkerApp } from './app.js';
import { ClamdScanner } from './clamd-scanner.js';
import { parseMediaWorkerConfig } from './config.js';
import { maximumUploadBytes } from './schemas.js';
import { MediaWorkerService } from './service.js';
import { StaticBearerAuthorization } from './static-bearer-authorization.js';

try {
  await start();
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

async function start(): Promise<void> {
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
  const app = await buildMediaWorkerApp({
    service,
    allowedOrigins: config.allowedOrigins,
    authorizeRequest: authorization.authorize,
    trustedProxyCidrs: config.trustedProxyCidrs,
  });
  const cleanupTimer = setInterval(() => {
    void service.cleanupExpired(100).catch((error: unknown) => {
      app.log.error(safeErrorFields(error), 'media staging cleanup failed');
    });
  }, config.cleanupIntervalMilliseconds);
  cleanupTimer.unref();
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(cleanupTimer);
    app.log.info({ signal }, 'media worker shutting down');
    await app.close();
    process.exitCode = 0;
  }

  const onSignal = (signal: string) => {
    void shutdown(signal).catch((error: unknown) => {
      app.log.error(safeErrorFields(error), 'media worker shutdown failed');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await app.close();
    throw error;
  }
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
