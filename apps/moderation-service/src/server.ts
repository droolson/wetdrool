import { pathToFileURL } from 'node:url';

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
  const store = createModerationStore(config);
  const service = new ModerationService({
    store,
    dangerouslyAllowUnverifiedLocalMode: config.dangerouslyAllowUnverifiedLocalMode,
  });
  const app = await buildModerationApp({
    service,
    allowedOrigins: config.allowedOrigins,
    readinessCheck: () => store.readiness(),
    transparencyMinimumCellSize: config.transparencyMinimumCellSize,
    trustedProxyCidrs: config.trustedProxyCidrs,
  });
  let maintenancePromise: Promise<void> | undefined;
  const maintenance = () => {
    maintenancePromise ??= service
      .runMaintenance(config.maintenance)
      .then((result) => {
        if (result.reviewRequired > 0 || result.actionsExpired > 0 || result.casesRemoved > 0) {
          app.log.info(result, 'Moderation ledger maintenance completed');
        }
      })
      .finally(() => {
        maintenancePromise = undefined;
      });
    return maintenancePromise;
  };
  if (store.kind === 'postgres') await maintenance();
  const maintenanceTimer = setInterval(() => {
    if (store.kind !== 'postgres') return;
    void maintenance().catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Moderation ledger maintenance failed',
      );
    });
  }, config.maintenanceIntervalMs);
  maintenanceTimer.unref();

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    clearInterval(maintenanceTimer);
    shutdownPromise ??= (async () => {
      await maintenancePromise;
      const results = await Promise.allSettled([app.close(), store.close()]);
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Moderation service shutdown failed.');
      }
    })();
    return shutdownPromise;
  };
  const handleSignal = () => {
    void shutdown().catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Moderation service shutdown failed',
      );
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
  await app.listen({ host: config.host, port: config.port });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startModerationServer();
}
