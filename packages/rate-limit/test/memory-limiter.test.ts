import { describe, expect, it } from 'vitest';

import {
  RATE_LIMIT_BACKEND_UNAVAILABLE,
  RATE_LIMITER_CLOSED,
  createExplicitMemoryRateLimiter,
  type ExplicitMemoryRateLimiterOptions,
  type RateLimitRequest,
} from '../src/index.js';

const request: RateLimitRequest = {
  namespace: 'loopback:test',
  key: 'client-a',
  limit: 1,
  windowMs: 1_000,
};

describe('explicit memory rate limiter', () => {
  it('requires an explicit runtime opt-in', () => {
    expect(() =>
      createExplicitMemoryRateLimiter({
        unsafeAllowMemory: false,
      } as unknown as ExplicitMemoryRateLimiterOptions),
    ).toThrow(/unsafeAllowMemory/u);
  });

  it('matches fixed-window consume and non-mutating read behavior', async () => {
    let now = 10_000;
    const limiter = createExplicitMemoryRateLimiter({
      unsafeAllowMemory: true,
      clock: () => now,
    });

    await expect(limiter.read(request)).resolves.toMatchObject({
      allowed: true,
      count: 0,
      remaining: 1,
      resetAt: 10_000,
    });
    await expect(limiter.consume(request)).resolves.toMatchObject({
      allowed: true,
      count: 1,
      remaining: 0,
      resetAt: 11_000,
    });
    await expect(limiter.read(request)).resolves.toMatchObject({
      allowed: true,
      count: 1,
    });
    await expect(limiter.consume(request)).resolves.toMatchObject({
      allowed: false,
      reason: 'limit-exceeded',
      count: 2,
    });

    now = 11_000;
    await expect(limiter.consume(request)).resolves.toMatchObject({
      allowed: true,
      count: 1,
      resetAt: 12_000,
    });
  });

  it('fails closed at bounded key capacity instead of evicting live buckets', async () => {
    const limiter = createExplicitMemoryRateLimiter({
      unsafeAllowMemory: true,
      maximumKeys: 1,
      clock: () => 25_000,
    });
    await limiter.consume(request);
    await expect(limiter.readiness()).resolves.toMatchObject({
      status: 'not-ready',
      ready: false,
      errorCode: RATE_LIMIT_BACKEND_UNAVAILABLE,
    });

    await expect(limiter.consume({ ...request, key: 'client-b' })).rejects.toMatchObject({
      code: RATE_LIMIT_BACKEND_UNAVAILABLE,
      statusCode: 503,
      operation: 'consume',
    });
    expect(limiter.health()).toMatchObject({
      status: 'not-ready',
      ready: false,
      errorCode: RATE_LIMIT_BACKEND_UNAVAILABLE,
    });
    await expect(limiter.read(request)).resolves.toMatchObject({ count: 1 });
  });

  it('isolates namespaces and has an idempotent close lifecycle', async () => {
    const limiter = createExplicitMemoryRateLimiter({
      unsafeAllowMemory: true,
      clock: () => 50_000,
    });

    await limiter.consume(request);
    await expect(limiter.read({ ...request, namespace: 'loopback:other' })).resolves.toMatchObject({
      count: 0,
    });
    await limiter.close();
    await limiter.close();
    expect(limiter.health()).toMatchObject({ status: 'closed', ready: false });
    await expect(limiter.consume(request)).rejects.toMatchObject({
      code: RATE_LIMITER_CLOSED,
      statusCode: 503,
    });
  });

  it('fails closed when a clock value would overflow the reset timestamp', async () => {
    const limiter = createExplicitMemoryRateLimiter({
      unsafeAllowMemory: true,
      clock: () => Number.MAX_SAFE_INTEGER,
    });

    await expect(limiter.consume({ ...request, windowMs: 1 })).rejects.toMatchObject({
      code: RATE_LIMIT_BACKEND_UNAVAILABLE,
      statusCode: 503,
    });
  });
});
