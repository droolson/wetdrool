import { describe, expect, it } from 'vitest';

import { parseRateLimitRuntimeConfig } from '../src/rate-limit.js';

const localSecret = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI';
const productionSecret = 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM';

describe('rate-limit runtime configuration', () => {
  it('requires both Redis and a private key secret by default', () => {
    expect(() => parseRateLimitRuntimeConfig({}, { serviceHost: '127.0.0.1' })).toThrow(
      /RATE_LIMIT_KEY_SECRET/u,
    );
    expect(() =>
      parseRateLimitRuntimeConfig(
        { RATE_LIMIT_KEY_SECRET: localSecret },
        { serviceHost: '127.0.0.1' },
      ),
    ).toThrow(/REDIS_URL/u);
  });

  it('accepts an authenticated local Redis endpoint', () => {
    expect(
      parseRateLimitRuntimeConfig(
        {
          RATE_LIMIT_KEY_SECRET: localSecret,
          REDIS_URL: 'redis://:local-development-only@127.0.0.1:6379',
        },
        { serviceHost: '0.0.0.0' },
      ),
    ).toEqual({
      backend: 'redis',
      deploymentId: 'local-development',
      keySecret: localSecret,
      redisUrl: 'redis://:local-development-only@127.0.0.1:6379',
    });
    expect(() =>
      parseRateLimitRuntimeConfig(
        {
          RATE_LIMIT_KEY_SECRET: localSecret,
          REDIS_URL: 'redis://127.0.0.1:6379',
        },
        { serviceHost: '127.0.0.1' },
      ),
    ).toThrow(/authentication/u);
  });

  it('allows memory state only through an explicit loopback development flag', () => {
    expect(
      parseRateLimitRuntimeConfig(
        {
          RATE_LIMIT_DANGEROUSLY_USE_MEMORY_STORE: '1',
          RATE_LIMIT_KEY_SECRET: localSecret,
        },
        { serviceHost: 'localhost' },
      ),
    ).toEqual({
      backend: 'memory',
      deploymentId: 'local-development',
      keySecret: localSecret,
    });
    expect(() =>
      parseRateLimitRuntimeConfig(
        {
          RATE_LIMIT_DANGEROUSLY_USE_MEMORY_STORE: '1',
          RATE_LIMIT_KEY_SECRET: localSecret,
          REDIS_URL: 'redis://:local-development-only@127.0.0.1:6379',
        },
        { serviceHost: 'localhost' },
      ),
    ).toThrow(/mutually exclusive/u);
    expect(() =>
      parseRateLimitRuntimeConfig(
        {
          RATE_LIMIT_DANGEROUSLY_USE_MEMORY_STORE: '1',
          RATE_LIMIT_KEY_SECRET: localSecret,
        },
        { serviceHost: '0.0.0.0' },
      ),
    ).toThrow(/loopback development/u);
    expect(() =>
      parseRateLimitRuntimeConfig(
        {
          APP_ENV: 'production',
          RATE_LIMIT_DANGEROUSLY_USE_MEMORY_STORE: '1',
          RATE_LIMIT_DEPLOYMENT_ID: 'production',
          RATE_LIMIT_KEY_SECRET: productionSecret,
        },
        { serviceHost: '127.0.0.1' },
      ),
    ).toThrow(/loopback development/u);
  });

  it('requires authenticated, nonlocal TLS Redis outside development', () => {
    const production = {
      APP_ENV: 'production',
      NODE_ENV: 'production',
      RATE_LIMIT_DEPLOYMENT_ID: 'production-us-east',
      RATE_LIMIT_KEY_SECRET: productionSecret,
    } as const;
    expect(() =>
      parseRateLimitRuntimeConfig(
        {
          ...production,
          REDIS_URL: 'redis://:secret@redis.wetdrool.com',
        },
        { serviceHost: '0.0.0.0' },
      ),
    ).toThrow(/rediss/u);
    expect(() =>
      parseRateLimitRuntimeConfig(
        {
          ...production,
          REDIS_URL: 'rediss://:secret@127.0.0.1',
        },
        { serviceHost: '0.0.0.0' },
      ),
    ).toThrow(/nonlocal/u);
    expect(() =>
      parseRateLimitRuntimeConfig(
        {
          ...production,
          REDIS_URL: 'rediss://redis.wetdrool.com',
        },
        { serviceHost: '0.0.0.0' },
      ),
    ).toThrow(/authentication/u);
    for (const password of ['local-development-only', 'local-development%2Donly']) {
      expect(() =>
        parseRateLimitRuntimeConfig(
          {
            ...production,
            REDIS_URL: `rediss://cache:${password}@redis.wetdrool.com`,
          },
          { serviceHost: '0.0.0.0' },
        ),
      ).toThrow(/public local Redis password/u);
    }
    expect(
      parseRateLimitRuntimeConfig(
        {
          ...production,
          REDIS_URL: 'rediss://cache:secret@redis.wetdrool.com',
        },
        { serviceHost: '0.0.0.0' },
      ),
    ).toMatchObject({ backend: 'redis' });
    expect(() =>
      parseRateLimitRuntimeConfig(
        {
          APP_ENV: 'production',
          NODE_ENV: 'production',
          RATE_LIMIT_KEY_SECRET: productionSecret,
          REDIS_URL: 'rediss://cache:secret@redis.wetdrool.com',
        },
        { serviceHost: '0.0.0.0' },
      ),
    ).toThrow(/RATE_LIMIT_DEPLOYMENT_ID/u);
    expect(() =>
      parseRateLimitRuntimeConfig(
        {
          ...production,
          NODE_TLS_REJECT_UNAUTHORIZED: '0',
          REDIS_URL: 'rediss://cache:secret@redis.wetdrool.com',
        },
        { serviceHost: '0.0.0.0' },
      ),
    ).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED/u);
  });

  it('rejects the published local secret without reflecting rejected secrets', () => {
    const rejectedSecret = 'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ';
    expect(() =>
      parseRateLimitRuntimeConfig(
        {
          APP_ENV: 'production',
          NODE_ENV: 'production',
          RATE_LIMIT_DEPLOYMENT_ID: 'production',
          RATE_LIMIT_KEY_SECRET: localSecret,
          REDIS_URL: 'rediss://cache:secret@redis.wetdrool.com',
        },
        { serviceHost: '0.0.0.0' },
      ),
    ).toThrow(/public local/u);
    try {
      parseRateLimitRuntimeConfig(
        {
          APP_ENV: 'production',
          NODE_ENV: 'production',
          RATE_LIMIT_DEPLOYMENT_ID: 'production',
          RATE_LIMIT_KEY_SECRET: rejectedSecret,
          REDIS_URL: 'not a URL',
        },
        { serviceHost: '0.0.0.0' },
      );
    } catch (error) {
      expect(String(error)).not.toContain(rejectedSecret);
    }
  });
});
