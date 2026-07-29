import { describe, expect, it, vi } from 'vitest';

import {
  RATE_LIMIT_BACKEND_UNAVAILABLE,
  RedisFixedWindowRateLimiter,
  createFastifyRateLimitStore,
  type FastifyRateLimitStoreResult,
  type RateLimiter,
  type WokeSocialFastifyRateLimitStore,
} from '../src/index.js';
import { FakeRedisTransport } from './fake-redis.js';

const secret = new Uint8Array(32).fill(0x11);

function callStore(
  store: WokeSocialFastifyRateLimitStore,
  operation: 'incr' | 'read',
  key: string,
  timeWindow = 1_000,
  max = 1,
): Promise<FastifyRateLimitStoreResult> {
  return new Promise((resolve, reject) => {
    store[operation](
      key,
      (error, result) => {
        if (error !== null) {
          reject(error);
        } else if (result === undefined) {
          reject(new Error('The Fastify store returned no result.'));
        } else {
          resolve(result);
        }
      },
      timeWindow,
      max,
    );
  });
}

describe('Fastify rate-limit store adapter', () => {
  it('is structurally compatible with @fastify/rate-limit 11.1.0', () => {
    const transport = new FakeRedisTransport(() => 1_000);
    const limiter = new RedisFixedWindowRateLimiter({
      transport,
      hmacSecret: secret,
      clock: () => 1_000,
      maxRetries: 0,
    });
    const Store = createFastifyRateLimitStore({
      limiter,
      namespace: 'http:global',
      clock: () => 1_000,
    });
    // @fastify/rate-limit 10.3's declaration exposes the two-argument method,
    // while its runtime supplies the optional window/max pair.
    const officialConstructor: new (options: unknown) => {
      incr(
        key: string,
        callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
      ): void;
      child(routeOptions: unknown): unknown;
    } = Store;

    expect(officialConstructor).toBe(Store);
  });

  it('implements increment, non-mutating read, and quota-exhaustion results', async () => {
    const transport = new FakeRedisTransport(() => 5_000);
    const limiter = new RedisFixedWindowRateLimiter({
      transport,
      hmacSecret: secret,
      clock: () => 5_000,
      maxRetries: 0,
    });
    const Store = createFastifyRateLimitStore({
      limiter,
      namespace: 'http:auth',
      clock: () => 5_000,
    });
    const store = new Store({});

    await expect(callStore(store, 'incr', '198.51.100.10')).resolves.toEqual({
      current: 1,
      ttl: 1_000,
    });
    await expect(callStore(store, 'read', '198.51.100.10')).resolves.toEqual({
      current: 1,
      ttl: 1_000,
    });
    await expect(callStore(store, 'incr', '198.51.100.10')).resolves.toEqual({
      current: 2,
      ttl: 1_000,
    });
  });

  it('isolates child routes without exposing route or client keys to Redis', async () => {
    const transport = new FakeRedisTransport(() => 8_000);
    const limiter = new RedisFixedWindowRateLimiter({
      transport,
      hmacSecret: secret,
      clock: () => 8_000,
      maxRetries: 0,
    });
    const Store = createFastifyRateLimitStore({
      limiter,
      namespace: 'http:service',
      clock: () => 8_000,
    });
    const parent = new Store({});
    const child = parent.child({
      routeInfo: { method: 'POST', url: '/private/reset-password' },
    });
    const rawClientKey = 'person@example.com';

    await callStore(parent, 'incr', rawClientKey);
    await callStore(child, 'incr', rawClientKey);

    expect(transport.evalCalls).toHaveLength(2);
    expect(transport.evalCalls[0]?.keys[0]).not.toBe(transport.evalCalls[1]?.keys[0]);
    for (const call of transport.evalCalls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(rawClientKey);
      expect(serialized).not.toContain('reset-password');
      expect(serialized).not.toContain('http:service');
    }
  });

  it('returns typed dependency failures to Fastify as 503 errors, never fake 429s', async () => {
    const transport = new FakeRedisTransport(() => 12_000);
    transport.evalFailuresRemaining = 1;
    const limiter = new RedisFixedWindowRateLimiter({
      transport,
      hmacSecret: secret,
      clock: () => 12_000,
      maxRetries: 0,
    });
    const Store = createFastifyRateLimitStore({
      limiter,
      namespace: 'http:service',
      clock: () => 12_000,
    });

    await expect(callStore(new Store({}), 'incr', '203.0.113.77')).rejects.toMatchObject({
      code: RATE_LIMIT_BACKEND_UNAVAILABLE,
      statusCode: 503,
    });
  });

  it('supports the two-argument typed shape and callbacks once on sync failure', () => {
    const synchronousFailure = new Error('synchronous limiter failure');
    const limiter: RateLimiter = {
      consume: () => {
        throw synchronousFailure;
      },
      read: () => {
        throw synchronousFailure;
      },
      readiness: async () => ({
        mode: 'redis',
        status: 'not-ready',
        ready: false,
        consecutiveFailures: 1,
        checkedAt: 1,
        lastSuccessAt: null,
        lastFailureAt: 1,
        errorCode: RATE_LIMIT_BACKEND_UNAVAILABLE,
      }),
      health: () => ({
        mode: 'redis',
        status: 'not-ready',
        ready: false,
        consecutiveFailures: 1,
        checkedAt: 1,
        lastSuccessAt: null,
        lastFailureAt: 1,
        errorCode: RATE_LIMIT_BACKEND_UNAVAILABLE,
      }),
      close: () => Promise.resolve(),
    };
    const Store = createFastifyRateLimitStore({
      limiter,
      namespace: 'http:service',
    });
    const missingOptionsCallback = vi.fn();
    const synchronousCallback = vi.fn();
    const store = new Store({});

    store.incr('client-key', missingOptionsCallback);
    store.incr('client-key', synchronousCallback, 1_000, 1);

    expect(missingOptionsCallback).toHaveBeenCalledOnce();
    expect(missingOptionsCallback).toHaveBeenCalledWith(expect.any(TypeError), undefined);
    expect(synchronousCallback).toHaveBeenCalledOnce();
    expect(synchronousCallback).toHaveBeenCalledWith(synchronousFailure, undefined);
  });

  it('callbacks once when the adapter clock throws after a decision', async () => {
    const transport = new FakeRedisTransport(() => 20_000);
    const limiter = new RedisFixedWindowRateLimiter({
      transport,
      hmacSecret: secret,
      clock: () => 20_000,
      maxRetries: 0,
    });
    const Store = createFastifyRateLimitStore({
      limiter,
      namespace: 'http:service',
      clock: () => {
        throw new Error('clock failed');
      },
    });
    const callback = vi.fn();

    new Store({}).incr('client-key', callback, 1_000, 1);
    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledOnce();
    });
    expect(callback).toHaveBeenCalledWith(expect.any(Error), undefined);
  });
});
