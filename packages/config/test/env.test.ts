import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  EnvironmentValidationError,
  parsePublicEnvironment,
  parseServerEnvironment,
  summarizeEnvironment,
} from '../src/env.ts';

function parseEnvironmentFile(source: string): Record<string, string> {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

const productionEnvironment = {
  ALLOWED_ORIGINS: 'https://woke.social',
  APP_ENV: 'production',
  DATABASE_MIGRATION_URL:
    'postgresql://migration:secret@db.woke.social/wokesocial?sslmode=verify-full',
  DATABASE_URL: 'postgresql://application:secret@db.woke.social/wokesocial?sslmode=verify-full',
  IPFS_API_URL: 'https://ipfs-api.woke.social',
  IPFS_GATEWAY_URL: 'https://gateway.woke.social',
  NEXT_PUBLIC_APP_ORIGIN: 'https://woke.social',
  NEXT_PUBLIC_AUTH_SERVICE_URL: 'https://auth.woke.social',
  NEXT_PUBLIC_FEED_SERVICE_URL: 'https://feed.woke.social',
  NEXT_PUBLIC_INDEXER_URL: 'https://indexer.woke.social',
  NEXT_PUBLIC_IPFS_GATEWAY_URL: 'https://gateway.woke.social',
  NEXT_PUBLIC_MEDIA_WORKER_URL: 'https://media.woke.social',
  NEXT_PUBLIC_MODERATION_SERVICE_URL: 'https://moderation.woke.social',
  NEXT_PUBLIC_PROGRAM_ID: '11111111111111111111111111111111',
  NEXT_PUBLIC_RELAY_URL: 'wss://relay.woke.social/v1/relay',
  NEXT_PUBLIC_SOLANA_CLUSTER: 'mainnet-beta',
  NEXT_PUBLIC_SOLANA_RPC_URL: 'https://rpc.woke.social',
  NODE_ENV: 'production',
  REDIS_URL: 'rediss://cache:secret@redis.woke.social',
  SESSION_SECRET: 'a-production-session-secret-with-32-characters',
  SOLANA_COMMITMENT: 'finalized',
  SOLANA_RPC_URLS: 'https://rpc.woke.social',
  SOLANA_WS_URLS: 'wss://rpc.woke.social',
} as const;

const stagingEnvironment = {
  ...productionEnvironment,
  APP_ENV: 'staging',
  DATABASE_MIGRATION_URL:
    'postgresql://migration:secret@db.staging.woke.social/wokesocial?sslmode=verify-full',
  DATABASE_URL:
    'postgresql://application:secret@db.staging.woke.social/wokesocial?sslmode=verify-full',
  NEXT_PUBLIC_SOLANA_CLUSTER: 'devnet',
} as const;

describe('environment configuration', () => {
  it('provides safe local defaults', () => {
    const environment = parseServerEnvironment({});

    expect(environment.APP_ENV).toBe('development');
    expect(environment.INDEXER_PORT).toBe(4000);
    expect(environment.NEXT_PUBLIC_AUTH_SERVICE_URL).toBe('http://localhost:4300');
    expect(environment.NEXT_PUBLIC_FEED_SERVICE_URL).toBe('http://localhost:4100');
    expect(environment.NEXT_PUBLIC_MEDIA_WORKER_URL).toBe('http://localhost:4500');
    expect(environment.NEXT_PUBLIC_MODERATION_SERVICE_URL).toBe('http://localhost:4400');
    expect(environment.NEXT_PUBLIC_RELAY_URL).toBe('ws://localhost:4200/v1/relay');
    expect(environment.NEXT_PUBLIC_SOLANA_CLUSTER).toBe('localnet');
    expect(environment.SOLANA_COMMITMENT).toBe('finalized');
    expect(environment.SPONSOR_ENABLED).toBe(false);
    expect(summarizeEnvironment(environment)).toMatchObject({
      rpcProviderCount: 1,
      sponsorEnabled: false,
      websocketProviderCount: 1,
    });
  });

  it('only returns public keys from the public parser', () => {
    const environment = parsePublicEnvironment({
      DATABASE_URL: 'postgresql://user:secret@example.test/database',
      NEXT_PUBLIC_APP_ORIGIN: 'https://woke.social',
    });

    expect(environment.NEXT_PUBLIC_APP_ORIGIN).toBe('https://woke.social');
    expect(environment).not.toHaveProperty('DATABASE_URL');
  });

  it('requires production identity and session configuration', () => {
    expect(() =>
      parseServerEnvironment({
        APP_ENV: 'production',
        NEXT_PUBLIC_APP_ORIGIN: 'https://woke.social',
      }),
    ).toThrowError(EnvironmentValidationError);
  });

  it('requires a signer and positive budget when sponsorship is enabled', () => {
    expect(() =>
      parseServerEnvironment({
        SPONSOR_ENABLED: 'true',
      }),
    ).toThrowError(/SPONSOR_SIGNER_URI/);
  });

  it('parses explicit provider lists and enabled sponsorship', () => {
    const environment = parseServerEnvironment({
      ALLOWED_ORIGINS: 'https://woke.social, https://app.woke.social',
      SOLANA_RPC_URLS: 'https://rpc-one.example,https://rpc-two.example',
      SOLANA_WS_URLS: 'wss://rpc-one.example,wss://rpc-two.example',
      SPONSOR_DAILY_LAMPORT_LIMIT: '1000000',
      SPONSOR_ENABLED: '1',
      SPONSOR_SIGNER_URI: 'kms://development/sponsor',
    });

    expect(environment.ALLOWED_ORIGINS).toHaveLength(2);
    expect(environment.SOLANA_RPC_URLS).toHaveLength(2);
    expect(environment.SOLANA_WS_URLS).toHaveLength(2);
    expect(environment.SPONSOR_ENABLED).toBe(true);
  });

  it('rejects malformed booleans, origins, protocols, and public RPC credentials', () => {
    expect(() => parseServerEnvironment({ SPONSOR_ENABLED: 'sometimes' })).toThrow();
    expect(() => parseServerEnvironment({ ALLOWED_ORIGINS: 'https://woke.social/path' })).toThrow(
      /origins without paths/,
    );
    expect(() => parseServerEnvironment({ DATABASE_URL: 'https://database.example' })).toThrow(
      /must use one of/,
    );
    expect(() =>
      parsePublicEnvironment({
        NEXT_PUBLIC_SOLANA_RPC_URL: 'https://user:password@rpc.example',
      }),
    ).toThrow(/must not include credentials/);
    expect(() =>
      parsePublicEnvironment({
        NEXT_PUBLIC_AUTH_SERVICE_URL: 'https://user:password@auth.example',
      }),
    ).toThrow(/must not include credentials/);
    expect(() =>
      parsePublicEnvironment({
        NEXT_PUBLIC_RELAY_URL: 'https://relay.example/v1/relay',
      }),
    ).toThrow(/must use one of/);
    expect(() =>
      parsePublicEnvironment({
        NEXT_PUBLIC_RELAY_URL: 'wss://user:password@relay.example/v1/relay',
      }),
    ).toThrow(/must not include credentials/);
  });

  it.each([
    ['NEXT_PUBLIC_APP_ORIGIN', 'https://sociallywoke.com'],
    ['NEXT_PUBLIC_APP_ORIGIN', 'https://SOCIALLYWOKE.COM..'],
    ['NEXT_PUBLIC_AUTH_SERVICE_URL', 'https://www.sociallywoke.com'],
    ['NEXT_PUBLIC_AUTH_SERVICE_URL', 'https://www.sociallywoke.com.'],
    ['NEXT_PUBLIC_RELAY_URL', 'wss://sociallywoke.com/v1/relay'],
    ['NEXT_PUBLIC_RELAY_URL', 'wss://sociallywoke.com../v1/relay'],
  ])('rejects the redirect-only hostname for %s', (key, value) => {
    expect(() => parsePublicEnvironment({ [key]: value })).toThrow(/legacy redirect-only hostname/);
  });

  it('rejects the redirect-only hostname from server CORS origins', () => {
    expect(() =>
      parseServerEnvironment({
        ALLOWED_ORIGINS: 'https://woke.social,https://SOCIALLYWOKE.COM..',
      }),
    ).toThrow(/legacy redirect hosts/);
  });

  it.each([
    ['NEXT_PUBLIC_WOKENET', 'NEXT_PUBLIC_SOLANA_CLUSTER'],
    ['NEXT_PUBLIC_WOKENET_RPC_URL', 'NEXT_PUBLIC_SOLANA_RPC_URL'],
    ['WOKENET_COMMITMENT', 'SOLANA_COMMITMENT'],
    ['WOKENET_RPC_URLS', 'SOLANA_RPC_URLS'],
    ['WOKENET_WS_URLS', 'SOLANA_WS_URLS'],
  ])('rejects retired %s instead of silently ignoring it', (retiredKey, replacementKey) => {
    expect(() => parseServerEnvironment({ [retiredKey]: 'retired-value' })).toThrow(
      new RegExp(`${retiredKey}.*${replacementKey}`, 's'),
    );
  });

  it('accepts a complete production configuration', () => {
    const environment = parseServerEnvironment(productionEnvironment);

    expect(environment.APP_ENV).toBe('production');
    expect(environment.NODE_ENV).toBe('production');
    expect(environment.NEXT_PUBLIC_SOLANA_CLUSTER).toBe('mainnet-beta');
  });

  it.each(['DATABASE_URL', 'DATABASE_MIGRATION_URL'] as const)(
    'requires hostname-verifying PostgreSQL TLS for production %s',
    (variableName) => {
      expect(() =>
        parseServerEnvironment({
          ...productionEnvironment,
          [variableName]: 'postgresql://application:secret@db.woke.social/wokesocial',
        }),
      ).toThrow(/sslmode=verify-full/u);
      expect(() =>
        parseServerEnvironment({
          ...productionEnvironment,
          [variableName]:
            'postgresql://application:secret@db.woke.social/wokesocial?sslmode=require',
        }),
      ).toThrow(/sslmode=verify-full/u);
    },
  );

  it.each(['DATABASE_URL', 'DATABASE_MIGRATION_URL'] as const)(
    'requires hostname-verifying PostgreSQL TLS for staging %s',
    (variableName) => {
      expect(() => parseServerEnvironment(stagingEnvironment)).not.toThrow();
      expect(() =>
        parseServerEnvironment({
          ...stagingEnvironment,
          [variableName]: 'postgresql://application:secret@db.staging.woke.social/wokesocial',
        }),
      ).toThrow(/sslmode=verify-full/u);
    },
  );

  it('rejects the process-wide Node TLS verification bypass in TLS-required environments', () => {
    expect(() =>
      parseServerEnvironment({
        ...productionEnvironment,
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      }),
    ).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED/u);
    expect(() =>
      parseServerEnvironment({
        APP_ENV: 'staging',
        DATABASE_URL:
          'postgresql://application:secret@db.staging.woke.social/wokesocial?sslmode=verify-full',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      }),
    ).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED/u);
  });

  it('rejects NODE_ENV production without an explicit nonlocal application mode', () => {
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL:
          'postgresql://application:secret@db.woke.social/wokesocial?sslmode=verify-full',
      }),
    ).toThrow(/APP_ENV/u);
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://application:secret@db.woke.social/wokesocial',
      }),
    ).toThrow(/sslmode=verify-full/u);
  });

  it('requires production Node semantics and secure dependencies in staging', () => {
    expect(() => parseServerEnvironment(stagingEnvironment)).not.toThrow();
    expect(() =>
      parseServerEnvironment({
        ...stagingEnvironment,
        NODE_ENV: 'development',
      }),
    ).toThrow(/NODE_ENV/u);
    expect(() =>
      parseServerEnvironment({
        ...stagingEnvironment,
        REDIS_URL: 'redis://cache:secret@redis.staging.woke.social',
      }),
    ).toThrow(/rediss/u);
    expect(() =>
      parseServerEnvironment({
        ...stagingEnvironment,
        SOLANA_RPC_URLS: 'http://rpc.staging.woke.social',
      }),
    ).toThrow(/non-local HTTPS endpoint/u);
  });

  it.each(['127.0.0.1', '[::1]', '[::ffff:7f00:1]', '[::]', 'app.localhost'])(
    'rejects local or unspecified host %s across nonlocal endpoint surfaces',
    (hostname) => {
      const endpointOverrides = [
        { ALLOWED_ORIGINS: `https://${hostname}` },
        {
          DATABASE_URL: `postgresql://application:secret@${hostname}/wokesocial?sslmode=verify-full`,
        },
        {
          DATABASE_MIGRATION_URL: `postgresql://migration:secret@${hostname}/wokesocial?sslmode=verify-full`,
        },
        { IPFS_API_URL: `https://${hostname}` },
        { IPFS_GATEWAY_URL: `https://${hostname}` },
        { NEXT_PUBLIC_APP_ORIGIN: `https://${hostname}` },
        { NEXT_PUBLIC_AUTH_SERVICE_URL: `https://${hostname}` },
        { NEXT_PUBLIC_FEED_SERVICE_URL: `https://${hostname}` },
        { NEXT_PUBLIC_INDEXER_URL: `https://${hostname}` },
        { NEXT_PUBLIC_IPFS_GATEWAY_URL: `https://${hostname}` },
        { NEXT_PUBLIC_MEDIA_WORKER_URL: `https://${hostname}` },
        { NEXT_PUBLIC_MODERATION_SERVICE_URL: `https://${hostname}` },
        { NEXT_PUBLIC_RELAY_URL: `wss://${hostname}/v1/relay` },
        { NEXT_PUBLIC_SOLANA_RPC_URL: `https://${hostname}` },
        { REDIS_URL: `rediss://cache:secret@${hostname}` },
        { SOLANA_RPC_URLS: `https://${hostname}` },
        { SOLANA_WS_URLS: `wss://${hostname}` },
      ];
      for (const override of endpointOverrides) {
        expect(() =>
          parseServerEnvironment({
            ...productionEnvironment,
            ...override,
          }),
        ).toThrow(/non-local|local or unspecified/u);
      }
    },
  );

  it('accepts only explicit Solana cluster names', () => {
    expect(() =>
      parsePublicEnvironment({
        NEXT_PUBLIC_SOLANA_CLUSTER: 'production',
      }),
    ).toThrow(/localnet.*devnet.*mainnet-beta/);
  });

  it('rejects local production origins and file-based production sponsor keys', () => {
    expect(() =>
      parseServerEnvironment({
        ...productionEnvironment,
        NEXT_PUBLIC_APP_ORIGIN: 'http://localhost:3000',
      }),
    ).toThrow(/non-local HTTPS origin/);

    expect(() =>
      parseServerEnvironment({
        ...productionEnvironment,
        SPONSOR_DAILY_LAMPORT_LIMIT: '1000',
        SPONSOR_ENABLED: 'true',
        SPONSOR_SIGNER_URI: 'file:///tmp/sponsor.json',
      }),
    ).toThrow(/file-based sponsor signers/);
  });

  it('rejects development runtime mode and local/insecure production dependencies', () => {
    expect(() =>
      parseServerEnvironment({
        ...productionEnvironment,
        NODE_ENV: 'development',
      }),
    ).toThrow(/NODE_ENV/u);
    expect(() =>
      parseServerEnvironment({
        ...productionEnvironment,
        NEXT_PUBLIC_SOLANA_CLUSTER: 'localnet',
      }),
    ).toThrow(/must be mainnet-beta/u);
    expect(() =>
      parseServerEnvironment({
        ...productionEnvironment,
        NEXT_PUBLIC_AUTH_SERVICE_URL: 'http://localhost:4300',
        SOLANA_RPC_URLS: 'http://127.0.0.1:8899',
      }),
    ).toThrow(/non-local HTTPS endpoint/u);
    expect(() =>
      parseServerEnvironment({
        ...productionEnvironment,
        REDIS_URL: 'redis://redis.woke.social',
      }),
    ).toThrow(/rediss/u);
  });

  it('never includes a rejected secret value in its error message', () => {
    const rejectedSecret = 'do-not-print-this';

    expect(() =>
      parseServerEnvironment({
        SESSION_SECRET: rejectedSecret,
      }),
    ).toThrowError(expect.not.stringContaining(rejectedSecret));
  });

  it('validates the checked-in local environment example', () => {
    const source = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    const environment = parseEnvironmentFile(source);

    expect(() => parseServerEnvironment(environment)).not.toThrow();
  });
});
