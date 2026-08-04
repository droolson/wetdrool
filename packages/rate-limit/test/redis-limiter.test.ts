import { describe, expect, it, vi } from 'vitest';

import {
  RATE_LIMIT_BACKEND_UNAVAILABLE,
  RATE_LIMITER_CLOSED,
  REDIS_FIXED_WINDOW_CONSUME_LUA,
  REDIS_FIXED_WINDOW_READ_LUA,
  REDIS_RATE_LIMIT_READINESS_LUA,
  RateLimitBackendUnavailableError,
  RateLimiterClosedError,
  RedisFixedWindowRateLimiter,
  deriveRateLimitRedisKey,
  type RateLimitRequest,
} from '../src/index.js';
import { FakeRedisTransport } from './fake-redis.js';

const secret = new Uint8Array(32).fill(0x5a);
const otherSecret = new Uint8Array(32).fill(0xa5);
const baseRequest: RateLimitRequest = {
  namespace: 'relay:publish',
  key: '203.0.113.9',
  limit: 2,
  windowMs: 1_000,
};

function setup(
  options: {
    now?: number;
    commandTimeoutMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
    onBackendError?: (error: RateLimitBackendUnavailableError) => void;
  } = {},
): {
  readonly clock: () => number;
  readonly advance: (milliseconds: number) => void;
  readonly transport: FakeRedisTransport;
  readonly limiter: RedisFixedWindowRateLimiter;
} {
  let now = options.now ?? 1_800_000_000_000;
  const clock = (): number => now;
  const transport = new FakeRedisTransport(clock);
  const limiter = new RedisFixedWindowRateLimiter({
    transport,
    hmacSecret: secret,
    clock,
    commandTimeoutMs: options.commandTimeoutMs ?? 100,
    maxRetries: options.maxRetries ?? 0,
    retryDelayMs: options.retryDelayMs ?? 0,
    ...(options.onBackendError === undefined ? {} : { onBackendError: options.onBackendError }),
  });
  return {
    clock,
    advance: (milliseconds) => {
      now += milliseconds;
    },
    transport,
    limiter,
  };
}

describe('RedisFixedWindowRateLimiter', () => {
  it('derives deterministic, domain-separated HMAC keys without raw values', () => {
    const first = deriveRateLimitRedisKey({
      secret,
      namespace: 'http:auth',
      key: 'person@example.com',
    });
    const same = deriveRateLimitRedisKey({
      secret,
      namespace: 'http:auth',
      key: 'person@example.com',
    });
    const otherNamespace = deriveRateLimitRedisKey({
      secret,
      namespace: 'relay:publish',
      key: 'person@example.com',
    });
    const otherKey = deriveRateLimitRedisKey({
      secret,
      namespace: 'http:auth',
      key: 'other@example.com',
    });
    const otherKeyMaterial = deriveRateLimitRedisKey({
      secret: otherSecret,
      namespace: 'http:auth',
      key: 'person@example.com',
    });

    expect(first).toBe(same);
    expect(new Set([first, otherNamespace, otherKey, otherKeyMaterial]).size).toBe(4);
    expect(first).toMatch(/^wetdrool:rate-limit:v1:[A-Za-z0-9_-]{43}:[A-Za-z0-9_-]{43}$/u);
    expect(first).not.toContain('http');
    expect(first).not.toContain('person');
    expect(first).not.toContain('example.com');
  });

  it('accepts the maximum deployment and service prefix admitted by runtime config', () => {
    const maximumIdentifier = `a${'b'.repeat(62)}`;
    const prefix = `wetdrool:rate-limit:v1:${maximumIdentifier}:${maximumIdentifier}`;
    expect(
      deriveRateLimitRedisKey({
        secret,
        namespace: 'http:service',
        key: 'client',
        prefix,
      }),
    ).toMatch(new RegExp(`^${prefix}:[A-Za-z0-9_-]{43}:[A-Za-z0-9_-]{43}$`, 'u'));
  });

  it('enforces a first-hit-anchored fixed window and reads without incrementing', async () => {
    const { advance, limiter } = setup();

    await expect(limiter.read(baseRequest)).resolves.toMatchObject({
      allowed: true,
      count: 0,
      remaining: 2,
      resetAt: 1_800_000_000_000,
    });
    const first = await limiter.consume(baseRequest);
    advance(400);
    const snapshot = await limiter.read(baseRequest);
    const second = await limiter.consume(baseRequest);
    const denied = await limiter.consume(baseRequest);

    expect(first).toMatchObject({
      allowed: true,
      reason: 'allowed',
      count: 1,
      remaining: 1,
      resetAt: 1_800_000_001_000,
    });
    expect(snapshot).toMatchObject({
      allowed: true,
      count: 1,
      remaining: 1,
      resetAt: 1_800_000_001_000,
    });
    expect(second).toMatchObject({ allowed: true, count: 2, remaining: 0 });
    expect(denied).toMatchObject({
      allowed: false,
      reason: 'limit-exceeded',
      count: 3,
      remaining: 0,
    });

    advance(600);
    await expect(limiter.consume(baseRequest)).resolves.toMatchObject({
      allowed: true,
      count: 1,
      resetAt: 1_800_000_002_000,
    });
  });

  it('admits exactly the limit under concurrent consumption', async () => {
    const { limiter } = setup();
    const decisions = await Promise.all(
      Array.from({ length: 100 }, () => limiter.consume({ ...baseRequest, limit: 10 })),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(10);
    expect(new Set(decisions.map((decision) => decision.count)).size).toBe(100);
    expect(Math.max(...decisions.map((decision) => decision.count))).toBe(100);
  });

  it('uses one atomic script call and never sends raw namespaces or identities to Redis', async () => {
    const { limiter, transport } = setup();
    const rawNamespace = 'http:password-reset';
    const rawKey = '2001:db8::dead:beef';

    await limiter.consume({
      namespace: rawNamespace,
      key: rawKey,
      limit: 5,
      windowMs: 60_000,
    });
    await limiter.read({
      namespace: rawNamespace,
      key: rawKey,
      limit: 5,
      windowMs: 60_000,
    });

    expect(transport.evalCalls).toHaveLength(2);
    expect(transport.evalCalls[0]?.script).toBe(REDIS_FIXED_WINDOW_CONSUME_LUA);
    expect(transport.evalCalls[1]?.script).toBe(REDIS_FIXED_WINDOW_READ_LUA);
    expect(REDIS_FIXED_WINDOW_CONSUME_LUA).toContain(
      "redis.call('SET', key, '1', 'PX', window_ms)",
    );
    expect(REDIS_FIXED_WINDOW_CONSUME_LUA).toContain("redis.call('INCR', key)");
    expect(REDIS_FIXED_WINDOW_CONSUME_LUA).toContain("redis.call('PEXPIRE', key, window_ms)");
    expect(REDIS_FIXED_WINDOW_CONSUME_LUA).toContain(
      'return {allowed, count, reset_at, remaining}',
    );
    for (const call of transport.evalCalls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(rawNamespace);
      expect(serialized).not.toContain(rawKey);
      expect(call.keys[0]).toMatch(
        /^wetdrool:rate-limit:v1:[A-Za-z0-9_-]{43}:[A-Za-z0-9_-]{43}$/u,
      );
    }
  });

  it('repairs a no-expiry counter without deleting or resetting its count', async () => {
    const { limiter, transport } = setup();
    const redisKey = deriveRateLimitRedisKey({
      secret,
      namespace: baseRequest.namespace,
      key: baseRequest.key,
    });
    transport.seedWithoutExpiry(redisKey, 7);

    await expect(limiter.consume({ ...baseRequest, limit: 10 })).resolves.toMatchObject({
      allowed: true,
      count: 8,
      remaining: 2,
      resetAt: 1_800_000_001_000,
    });
    transport.seedWithoutExpiry(redisKey, 8);
    await expect(limiter.read({ ...baseRequest, limit: 10 })).resolves.toMatchObject({
      count: 8,
      resetAt: 1_800_000_001_000,
    });
    expect(REDIS_FIXED_WINDOW_CONSUME_LUA).not.toContain("redis.call('DEL', key)");
    expect(REDIS_FIXED_WINDOW_READ_LUA).not.toContain("redis.call('DEL', key)");
  });

  it('retries within the configured bound and recovers readiness after success', async () => {
    const errors: RateLimitBackendUnavailableError[] = [];
    const { limiter, transport } = setup({
      maxRetries: 1,
      onBackendError: (error) => errors.push(error),
    });
    transport.evalFailuresRemaining = 1;

    await expect(limiter.consume(baseRequest)).resolves.toMatchObject({
      allowed: true,
      count: 1,
    });
    expect(transport.evalCalls).toHaveLength(2);
    expect(errors).toHaveLength(0);
    expect(limiter.health()).toMatchObject({
      ready: true,
      status: 'ready',
      consecutiveFailures: 0,
    });
  });

  it('fails closed with a stable 503 error and no memory fallback', async () => {
    const errors: RateLimitBackendUnavailableError[] = [];
    const { limiter, transport } = setup({
      maxRetries: 1,
      onBackendError: (error) => errors.push(error),
    });
    transport.evalFailuresRemaining = 2;

    const failure = limiter.consume(baseRequest);
    await expect(failure).rejects.toBeInstanceOf(RateLimitBackendUnavailableError);
    await expect(failure).rejects.toMatchObject({
      code: RATE_LIMIT_BACKEND_UNAVAILABLE,
      statusCode: 503,
      operation: 'consume',
      attempts: 2,
    });
    expect(transport.evalCalls).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(Object.hasOwn(errors[0] ?? {}, 'cause')).toBe(false);
    expect(limiter.health()).toMatchObject({
      ready: false,
      status: 'not-ready',
      consecutiveFailures: 1,
      errorCode: RATE_LIMIT_BACKEND_UNAVAILABLE,
    });
  });

  it('treats malformed Redis output as a fail-closed backend failure', async () => {
    const { limiter, transport } = setup();
    transport.nextEvalResult = [1, 100, 0, 2];

    await expect(limiter.consume(baseRequest)).rejects.toMatchObject({
      code: RATE_LIMIT_BACKEND_UNAVAILABLE,
      statusCode: 503,
    });
  });

  it('rejects an otherwise consistent stale reset timestamp', async () => {
    const { limiter, transport } = setup();
    transport.nextEvalResult = [1, 1, 0, 1];

    await expect(limiter.consume(baseRequest)).rejects.toMatchObject({
      code: RATE_LIMIT_BACKEND_UNAVAILABLE,
      statusCode: 503,
    });
  });

  it('bounds hanging commands by timeout and retry count', async () => {
    const { limiter, transport } = setup({
      commandTimeoutMs: 5,
      maxRetries: 1,
    });
    transport.hangEval = true;
    const startedAt = performance.now();

    await expect(limiter.consume(baseRequest)).rejects.toMatchObject({
      code: RATE_LIMIT_BACKEND_UNAVAILABLE,
      attempts: 2,
    });
    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(transport.evalCalls).toHaveLength(2);
  });

  it('actively probes required Redis capabilities and closes the transport exactly once', async () => {
    const { limiter, transport } = setup({ maxRetries: 0 });

    expect(limiter.health()).toMatchObject({ status: 'unverified', ready: false });
    await expect(limiter.readiness()).resolves.toMatchObject({
      status: 'ready',
      ready: true,
    });
    expect(transport.evalCalls).toHaveLength(1);
    expect(transport.evalCalls[0]?.script).toBe(REDIS_RATE_LIMIT_READINESS_LUA);
    expect(REDIS_RATE_LIMIT_READINESS_LUA).toContain(
      "redis.call('SET', key, '0', 'PX', probe_ttl_ms)",
    );
    expect(REDIS_RATE_LIMIT_READINESS_LUA).toContain("redis.call('INCR', key)");
    expect(REDIS_RATE_LIMIT_READINESS_LUA).toContain("redis.call('PEXPIRE', key, probe_ttl_ms)");
    expect(REDIS_RATE_LIMIT_READINESS_LUA).toContain("redis.call('PTTL', key)");
    expect(REDIS_RATE_LIMIT_READINESS_LUA).toContain("redis.call('GET', key)");
    expect(transport.evalCalls[0]?.keys[0]).toMatch(
      /^wetdrool:rate-limit:v1:[A-Za-z0-9_-]{43}:[A-Za-z0-9_-]{43}$/u,
    );

    transport.nextEvalResult = [1, 1, -1, 1, 1];
    await expect(limiter.readiness()).resolves.toMatchObject({
      status: 'not-ready',
      ready: false,
      errorCode: RATE_LIMIT_BACKEND_UNAVAILABLE,
    });

    await Promise.all([limiter.close(), limiter.close()]);
    expect(transport.closeCalls).toBe(1);
    expect(limiter.health()).toMatchObject({ status: 'closed', ready: false });
    await expect(limiter.readiness()).resolves.toMatchObject({ status: 'closed' });
    const afterClose = limiter.consume(baseRequest);
    await expect(afterClose).rejects.toBeInstanceOf(RateLimiterClosedError);
    await expect(afterClose).rejects.toMatchObject({
      code: RATE_LIMITER_CLOSED,
      statusCode: 503,
    });
  });

  it('bounds close latency and preserves a closed lifecycle state', async () => {
    const { limiter, transport } = setup({ commandTimeoutMs: 5 });
    transport.hangClose = true;

    await expect(limiter.close()).rejects.toMatchObject({
      code: RATE_LIMIT_BACKEND_UNAVAILABLE,
      statusCode: 503,
      operation: 'close',
      attempts: 1,
    });
    expect(limiter.health()).toMatchObject({
      status: 'closed',
      ready: false,
      errorCode: RATE_LIMIT_BACKEND_UNAVAILABLE,
    });
  });

  it('does not let an observability callback alter fail-closed behavior', async () => {
    const hook = vi.fn(() => {
      throw new Error('logger failure');
    });
    const { limiter, transport } = setup({ onBackendError: hook });
    transport.evalFailuresRemaining = 1;

    await expect(limiter.consume(baseRequest)).rejects.toMatchObject({
      code: RATE_LIMIT_BACKEND_UNAVAILABLE,
    });
    expect(hook).toHaveBeenCalledOnce();
  });
});
