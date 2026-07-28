import { buildAuthApp } from '../../auth-service/src/app.js';
import { MemoryAuthStore } from '../../auth-service/src/memory-store.js';
import { AuthService } from '../../auth-service/src/service.js';

const port = Number(process.env['WOKESOCIAL_AUTH_PORT'] ?? '4300');
const origin = process.env['WOKESOCIAL_WEB_ORIGIN'] ?? 'http://localhost:3000';
const store = new MemoryAuthStore();
const service = new AuthService({
  store,
  rpName: 'WokeSocial browser test',
  rpId: 'localhost',
  origin,
});
const app = await buildAuthApp({
  service,
  logger: false,
  // Parallel browser actors share one loopback IP. Keep the real limiter
  // installed while preventing unrelated scenarios from exhausting one quota.
  rateLimitMax: 200,
});

let shutdownPromise: Promise<void> | undefined;
const shutdown = () => {
  shutdownPromise ??= Promise.allSettled([app.close(), store.close()]).then((results) => {
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Browser auth fixture shutdown failed.');
    }
  });
  return shutdownPromise;
};
const handleSignal = () => {
  void shutdown().catch(() => {
    process.exitCode = 1;
  });
};

process.once('SIGINT', handleSignal);
process.once('SIGTERM', handleSignal);
await app.listen({ host: '127.0.0.1', port });
