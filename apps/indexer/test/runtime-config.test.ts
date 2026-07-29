import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { readIndexerConfig, removeIndexerSetupOnlyVariables } from '../src/config.js';
import { readMigrationDatabaseUrl } from '../src/migrate.js';

const programId = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const networkId = `wokenet:v1:11111111111111111111111111111111:${programId}`;

describe('indexer runtime configuration', () => {
  it('keeps runtime and migration database roles distinct', () => {
    expect(() =>
      readIndexerConfig({
        DATABASE_URL: 'postgresql://runtime:runtime-secret@database.test/wokesocial',
        DATABASE_MIGRATION_URL: 'postgresql://migration:migration-secret@database.test/wokesocial',
      }),
    ).toThrow('Privileged database credentials must not be injected');
    expect(() =>
      readIndexerConfig({
        AUTH_DATABASE_MIGRATION_URL:
          'postgresql://migration:migration-secret@database.test/wokesocial',
      }),
    ).toThrow('Privileged database credentials must not be injected');
    expect(
      readMigrationDatabaseUrl({
        DATABASE_MIGRATION_URL: 'postgresql://migration:migration-secret@database.test/wokesocial',
      }),
    ).toBe('postgresql://migration:migration-secret@database.test/wokesocial');
    expect(() =>
      readMigrationDatabaseUrl({ DATABASE_MIGRATION_URL: 'https://database.test' }),
    ).toThrow('must use postgres:// or postgresql://');
    const sentinel = 'SENTINEL_INDEXER_MIGRATION_SECRET';
    try {
      readMigrationDatabaseUrl({
        DATABASE_MIGRATION_URL: `postgresql://migration:${sentinel}@[invalid/wokesocial`,
      });
      throw new Error('Expected malformed migration URL rejection.');
    } catch (error) {
      expect(inspect(error, { depth: null })).not.toContain(sentinel);
    }
  });

  it('aligns production Node mode with either staging or production application policy', () => {
    expect(() =>
      readIndexerConfig({
        APP_ENV: 'development',
        DATABASE_URL: 'postgresql://runtime:secret@database.test/wokesocial?sslmode=verify-full',
        NODE_ENV: 'production',
      }),
    ).toThrow('NODE_ENV must be production exactly');
    expect(() =>
      readIndexerConfig({
        APP_ENV: 'staging',
        NODE_ENV: 'development',
      }),
    ).toThrow('NODE_ENV must be production exactly');
    for (const appEnvironment of ['staging', 'production'] as const) {
      expect(readIndexerConfig(nonlocalEnvironment(appEnvironment))).toMatchObject({
        databaseUrl:
          'postgresql://indexer_runtime:secret@database.test/wokesocial?sslmode=verify-full',
        sync: { networkId, programId },
      });
    }
  });

  it('uses a minimal indexer-only nonlocal dependency set', () => {
    const config = readIndexerConfig(nonlocalEnvironment('staging'));
    expect(config.sync?.rpcUrls).toEqual(['https://rpc.wokenet.test']);
    expect(config.allowedOrigins).toEqual(['https://woke.social']);
    expect(config).not.toHaveProperty('sessionSecret');
    expect(config).not.toHaveProperty('redisUrl');
    expect(config).not.toHaveProperty('ipfsApiUrl');
  });

  it('rejects nonlocal transport downgrades and local endpoints', () => {
    for (const override of [
      { ALLOWED_ORIGINS: 'http://woke.social' },
      { ALLOWED_ORIGINS: 'https://app.localhost' },
      { ALLOWED_ORIGINS: 'https://127.0.0.5' },
      { WOKENET_RPC_URLS: 'http://rpc.wokenet.test' },
      { WOKENET_RPC_URLS: 'https://[::ffff:127.0.0.1]' },
      {
        DATABASE_URL:
          'postgresql://indexer_runtime:secret@127.0.0.1/wokesocial?sslmode=verify-full',
      },
    ]) {
      expect(() =>
        readIndexerConfig({
          ...nonlocalEnvironment('staging'),
          ...override,
        }),
      ).toThrow(/Nonlocal indexer|database TLS|DNS hostname/u);
    }
  });

  it('requires a complete network identity in every mode and requires sync in nonlocal modes', () => {
    expect(() => readIndexerConfig({ INDEXER_NETWORK_ID: networkId })).toThrow(
      /must be configured together/u,
    );
    expect(() => readIndexerConfig({ NEXT_PUBLIC_PROGRAM_ID: programId })).toThrow(
      /must be configured together/u,
    );
    const missingIdentity: Record<string, string | undefined> = nonlocalEnvironment('production');
    delete missingIdentity.INDEXER_NETWORK_ID;
    delete missingIdentity.NEXT_PUBLIC_PROGRAM_ID;
    expect(() => readIndexerConfig(missingIdentity)).toThrow(/are required in staging/u);
  });

  it.each(['SESSION_SECRET', 'SPONSOR_SIGNER_URI'])(
    'rejects unrelated sensitive runtime variable %s',
    (name) => {
      expect(() =>
        readIndexerConfig({
          [name]: 'sentinel-sensitive-value',
        }),
      ).toThrow(`${name} must not be injected`);
    },
  );

  it('retains the shared limiter runtime connection while scrubbing setup secrets', () => {
    const environment = {
      DATABASE_MIGRATION_URL: 'postgresql://migration:secret@localhost/wokesocial',
      DATABASE_URL: 'postgresql://indexer:secret@localhost/wokesocial',
      RATE_LIMIT_DEPLOYMENT_ID: 'local-development',
      RATE_LIMIT_KEY_SECRET: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
      REDIS_URL: 'redis://:secret@127.0.0.1:6379',
    };
    removeIndexerSetupOnlyVariables(environment);
    expect(environment).toEqual({
      DATABASE_URL: 'postgresql://indexer:secret@localhost/wokesocial',
      RATE_LIMIT_DEPLOYMENT_ID: 'local-development',
      RATE_LIMIT_KEY_SECRET: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
      REDIS_URL: 'redis://:secret@127.0.0.1:6379',
    });
  });

  it.each([
    'AUTH_DATABASE_RUNTIME_PASSWORD',
    'AUTH_DATABASE_URL',
    'MEDIA_WORKER_STATIC_BEARER_TOKEN',
    'MODERATION_DATABASE_URL',
    'MODERATION_DATA_KEYS',
    'PGPASSWORD',
    'POSTGRES_PASSWORD',
    'RELAY_KEY_AUTHORIZER_BEARER_TOKEN',
    'RELAY_SUBSCRIPTION_AUTHORIZER_BEARER_TOKEN',
  ])('rejects nonlocal shared-service secret %s without reflecting its value', (name) => {
    const sentinel = `SENTINEL_INDEXER_SHARED_SECRET_${name}`;
    try {
      readIndexerConfig({
        ...nonlocalEnvironment('staging'),
        [name]: sentinel,
      });
      throw new Error('Expected shared-service secret rejection.');
    } catch (error) {
      expect(inspect(error, { depth: null })).not.toContain(sentinel);
      expect(String(error)).toContain('must not be injected');
    }
  });

  it('keeps packaged nonlocal defaults fail-closed and scrubs setup-only variables locally', async () => {
    const [dockerfile, setupSource, devSource] = await Promise.all([
      readFile(new URL('../Dockerfile', import.meta.url), 'utf8'),
      readFile(new URL('../src/setup-local.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/dev.ts', import.meta.url), 'utf8'),
    ]);
    expect(dockerfile).toContain('ENV APP_ENV=production');
    expect(dockerfile).toContain('NODE_ENV=production');
    for (const source of [setupSource, devSource]) {
      expect(source).toContain('removeIndexerSetupOnlyVariables');
    }

    const environment = {
      AUTH_DATABASE_URL: 'postgresql://auth:secret@localhost/wokesocial',
      AUTH_DATABASE_RUNTIME_PASSWORD: 'auth-secret',
      DATABASE_MIGRATION_URL: 'postgresql://migration:secret@localhost/wokesocial',
      DATABASE_URL: 'postgresql://indexer:secret@localhost/wokesocial',
      PGPASSWORD: 'bootstrap-secret',
      SAFE_VALUE: 'retained',
    };
    removeIndexerSetupOnlyVariables(environment);
    expect(environment).toEqual({
      DATABASE_URL: 'postgresql://indexer:secret@localhost/wokesocial',
      SAFE_VALUE: 'retained',
    });
  });

  it('requires exact hostname-verifying TLS for production migrations', () => {
    expect(
      readMigrationDatabaseUrl({
        APP_ENV: 'production',
        DATABASE_MIGRATION_URL:
          'postgresql://migration:secret@database.test/wokesocial?sslmode=verify-full',
      }),
    ).toContain('sslmode=verify-full');

    for (const sslQuery of [
      '',
      '?sslmode=prefer',
      '?sslmode=require',
      '?sslmode=verify-ca',
      '?sslmode=verify-full&sslmode=require',
    ]) {
      expect(() =>
        readMigrationDatabaseUrl({
          APP_ENV: 'production',
          DATABASE_MIGRATION_URL: `postgresql://migration:secret@database.test/wokesocial${sslQuery}`,
        }),
      ).toThrow('must set exactly one sslmode=verify-full');
    }

    for (const environment of [
      { APP_ENV: 'staging' },
      { APP_ENV: 'development', NODE_ENV: 'production' },
    ]) {
      expect(() =>
        readMigrationDatabaseUrl({
          ...environment,
          DATABASE_MIGRATION_URL: 'postgresql://migration:secret@database.test/wokesocial',
        }),
      ).toThrow('must set exactly one sslmode=verify-full');
    }
    expect(() =>
      readMigrationDatabaseUrl({
        APP_ENV: 'staging',
        DATABASE_MIGRATION_URL:
          'postgresql://migration:secret@database.test/wokesocial?sslmode=verify-full',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      }),
    ).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED must not be 0/u);
  });

  it('parses explicit trusted proxy ranges and rejects broad trust', () => {
    expect(
      readIndexerConfig({
        TRUSTED_PROXY_CIDRS: '127.0.0.1/32,10.42.0.0/24',
      }).trustedProxyCidrs,
    ).toEqual(['127.0.0.1/32', '10.42.0.0/24']);
    expect(
      readIndexerConfig({
        INDEXER_PROFILE_V2_ACTIVATION_SLOT: '184467',
      }).profileSchemaV2ActivationSlot,
    ).toBe(184467n);
    expect(() => readIndexerConfig({ INDEXER_PROFILE_V2_ACTIVATION_SLOT: '-1' })).toThrow();
    expect(() =>
      readIndexerConfig({
        INDEXER_PROFILE_V2_ACTIVATION_SLOT: String(Number.MAX_SAFE_INTEGER + 1),
      }),
    ).toThrow();
    expect(() => readIndexerConfig({ TRUSTED_PROXY_CIDRS: '0.0.0.0/0' })).toThrow(
      /TRUSTED_PROXY_CIDRS/u,
    );
  });

  it('requires an explicit staleness budget longer than the polling interval', () => {
    expect(() =>
      readIndexerConfig({
        INDEXER_NETWORK_ID: networkId,
        INDEXER_POLL_INTERVAL_MS: '5000',
        INDEXER_SYNC_STALE_AFTER_MS: '5000',
        NEXT_PUBLIC_PROGRAM_ID: programId,
      }),
    ).toThrow('must be greater than INDEXER_POLL_INTERVAL_MS');
  });
});

function nonlocalEnvironment(appEnvironment: 'staging' | 'production') {
  return {
    ALLOWED_ORIGINS: 'https://woke.social',
    APP_ENV: appEnvironment,
    DATABASE_URL:
      'postgresql://indexer_runtime:secret@database.test/wokesocial?sslmode=verify-full',
    INDEXER_NETWORK_ID: networkId,
    NEXT_PUBLIC_PROGRAM_ID: programId,
    NODE_ENV: 'production',
    WOKENET_RPC_URLS: 'https://rpc.wokenet.test',
  };
}
