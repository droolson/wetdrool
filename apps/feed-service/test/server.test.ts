import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildApp: vi.fn(),
  createRateLimiter: vi.fn(),
  parseConfig: vi.fn(),
  parseRateLimitConfig: vi.fn(),
}));

vi.mock('@wokesocial/config/rate-limit', () => ({
  parseRateLimitRuntimeConfig: mocks.parseRateLimitConfig,
}));
vi.mock('@wokesocial/rate-limit', () => ({
  createRuntimeRateLimiter: mocks.createRateLimiter,
}));
vi.mock('../src/app.js', () => ({
  buildFeedServiceApp: mocks.buildApp,
}));
vi.mock('../src/config.js', () => ({
  parseFeedServiceConfig: mocks.parseConfig,
}));

import { startFeedService } from '../src/server.js';

const keySecret = Buffer.alloc(32, 2).toString('base64url');

describe('feed service startup ownership', () => {
  beforeEach(() => {
    mocks.parseConfig.mockReturnValue({
      allowedOrigins: [],
      host: '127.0.0.1',
      port: 4100,
      trustedProxyCidrs: [],
    });
    mocks.parseRateLimitConfig.mockReturnValue({
      backend: 'memory',
      deploymentId: 'test',
      keySecret,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    Reflect.deleteProperty(process.env, 'RATE_LIMIT_KEY_SECRET');
    Reflect.deleteProperty(process.env, 'REDIS_URL');
  });

  it('closes the limiter directly and preserves the build error before ownership transfer', async () => {
    const startupError = new Error('app construction failed');
    const limiter = createLimiter();
    mocks.createRateLimiter.mockResolvedValue(limiter);
    mocks.buildApp.mockRejectedValue(startupError);
    process.env.RATE_LIMIT_KEY_SECRET = keySecret;
    process.env.REDIS_URL = 'redis://:sensitive@127.0.0.1:6379';

    await expect(startFeedService()).rejects.toBe(startupError);

    expect(limiter.close).toHaveBeenCalledOnce();
    expect(process.env.RATE_LIMIT_KEY_SECRET).toBeUndefined();
    expect(process.env.REDIS_URL).toBeUndefined();
  });

  it('closes both owners after transfer, preserves listen failure, and logs sanitized events', async () => {
    const listenError = new Error('listen failed');
    const closeError = new Error('close failed');
    const limiter = createLimiter();
    let reportBackendError:
      ((event: { code: string; operation: 'consume'; attempts: number }) => void) | undefined;
    mocks.createRateLimiter.mockImplementation((options) => {
      reportBackendError = options.onBackendError;
      return Promise.resolve(limiter);
    });
    const app = {
      close: vi.fn().mockRejectedValue(closeError),
      listen: vi.fn().mockImplementation(() => {
        reportBackendError?.({
          code: 'RATE_LIMIT_BACKEND_UNAVAILABLE',
          operation: 'consume',
          attempts: 2,
        });
        return Promise.reject(listenError);
      }),
      log: {
        error: vi.fn(),
        info: vi.fn(),
      },
    };
    mocks.buildApp.mockResolvedValue(app);
    const sigintListeners = process.listenerCount('SIGINT');
    const sigtermListeners = process.listenerCount('SIGTERM');

    await expect(startFeedService()).rejects.toBe(listenError);

    expect(app.close).toHaveBeenCalledOnce();
    expect(limiter.close).toHaveBeenCalledOnce();
    expect(app.log.error).toHaveBeenCalledWith(
      {
        code: 'RATE_LIMIT_BACKEND_UNAVAILABLE',
        operation: 'consume',
        attempts: 2,
      },
      'Rate-limit backend unavailable',
    );
    expect(process.listenerCount('SIGINT')).toBe(sigintListeners);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners);
  });
});

function createLimiter() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn(),
    health: vi.fn(),
    read: vi.fn(),
    readiness: vi.fn(),
  };
}
