import { describe, expect, it } from 'vitest';

import {
  assertNoClientKeyMaterial,
  credentialIdParamSchema,
  equalHash,
  hashSecret,
  parseAuthConfig,
  parseSessionCookie,
  randomSessionId,
  randomToken,
  sessionCookieValue,
} from '../src/index.js';

describe('authentication service security primitives', () => {
  it('keeps the development store behind an explicit dangerous flag', () => {
    expect(() =>
      parseAuthConfig({
        AUTH_RP_ID: 'localhost',
        AUTH_ORIGIN: 'http://localhost:4300',
      }),
    ).toThrow('AUTH_DATABASE_URL is required');
    expect(
      parseAuthConfig({
        AUTH_RP_ID: 'localhost',
        AUTH_ORIGIN: 'http://localhost:4300',
        AUTH_DANGEROUSLY_USE_MEMORY_STORE: '1',
      }),
    ).toMatchObject({
      rpId: 'localhost',
      origin: 'http://localhost:4300',
      dangerouslyUseMemoryStore: true,
    });
    expect(
      parseAuthConfig({
        AUTH_DANGEROUSLY_USE_MEMORY_STORE: '1',
        TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
      }),
    ).toMatchObject({
      port: 4300,
      rpId: 'localhost',
      origin: 'http://localhost:4300',
      cleanupIntervalMs: 60_000,
      trustedProxyCidrs: ['127.0.0.1/32'],
      retention: {
        pendingAccountRetentionMs: 3_600_000,
        ceremonyRetentionMs: 86_400_000,
        sessionRetentionMs: 604_800_000,
        batchSize: 500,
      },
    });
    expect(() =>
      parseAuthConfig({
        NODE_ENV: 'production',
        AUTH_RP_ID: 'woke.social',
        AUTH_ORIGIN: 'https://auth.woke.social',
        AUTH_DANGEROUSLY_USE_MEMORY_STORE: '1',
      }),
    ).toThrow(/restricted to loopback development/u);
    expect(() =>
      parseAuthConfig({
        APP_ENV: 'staging',
        AUTH_RP_ID: 'woke.social',
        AUTH_ORIGIN: 'https://auth.woke.social',
        AUTH_DANGEROUSLY_USE_MEMORY_STORE: '1',
      }),
    ).toThrow(/restricted to loopback development/u);
    expect(() =>
      parseAuthConfig({
        APP_ENV: 'production',
        NODE_ENV: 'development',
        AUTH_RP_ID: 'woke.social',
        AUTH_ORIGIN: 'https://auth.woke.social',
        AUTH_DANGEROUSLY_USE_MEMORY_STORE: '1',
      }),
    ).toThrow(/restricted to loopback development/u);
    expect(() =>
      parseAuthConfig({
        AUTH_HOST: '0.0.0.0',
        AUTH_DANGEROUSLY_USE_MEMORY_STORE: '1',
      }),
    ).toThrow(/restricted to loopback development/u);
  });

  it('requires a nonlocal HTTPS RP and origin in staging and production', () => {
    for (const appEnvironment of ['staging', 'production'] as const) {
      expect(() =>
        parseAuthConfig({
          APP_ENV: appEnvironment,
          AUTH_DATABASE_URL:
            'postgresql://authentication:secret@db.woke.social/auth?sslmode=verify-full',
        }),
      ).toThrow(/nonlocal HTTPS endpoint/u);
      for (const [origin, rpId] of [
        ['https://localhost', 'localhost'],
        ['https://auth.localhost', 'localhost'],
        ['https://127.0.0.9', '127.0.0.9'],
        ['https://[::ffff:127.0.0.1]', 'localhost'],
        ['https://0.0.0.0', '0.0.0.0'],
      ]) {
        expect(() =>
          parseAuthConfig({
            APP_ENV: appEnvironment,
            AUTH_DATABASE_URL:
              'postgresql://authentication:secret@db.woke.social/auth?sslmode=verify-full',
            AUTH_ORIGIN: origin,
            AUTH_RP_ID: rpId,
          }),
        ).toThrow(/nonlocal/u);
      }
    }
  });

  it('rejects insecure remote origins, RP mismatches, and non-PostgreSQL stores', () => {
    expect(
      parseAuthConfig({
        AUTH_RP_ID: 'woke.social',
        AUTH_ORIGIN: 'https://woke.social',
        AUTH_DANGEROUSLY_USE_MEMORY_STORE: '1',
      }),
    ).toMatchObject({ rpId: 'woke.social', origin: 'https://woke.social' });
    expect(() =>
      parseAuthConfig({
        AUTH_RP_ID: 'woke.social',
        AUTH_ORIGIN: 'https://sociallywoke.com',
        AUTH_DANGEROUSLY_USE_MEMORY_STORE: '1',
      }),
    ).toThrow('legacy redirect hostname');
    expect(() =>
      parseAuthConfig({
        AUTH_RP_ID: 'sociallywoke.com',
        AUTH_ORIGIN: 'https://sociallywoke.com',
        AUTH_DANGEROUSLY_USE_MEMORY_STORE: '1',
      }),
    ).toThrow('legacy redirect hostname');
    expect(() =>
      parseAuthConfig({
        AUTH_RP_ID: 'com',
        AUTH_ORIGIN: 'https://WWW.SOCIALLYWOKE.COM..',
        AUTH_DANGEROUSLY_USE_MEMORY_STORE: '1',
      }),
    ).toThrow('legacy redirect hostname');
    expect(() =>
      parseAuthConfig({
        AUTH_RP_ID: 'example.com',
        AUTH_ORIGIN: 'http://example.com',
        AUTH_DANGEROUSLY_USE_MEMORY_STORE: '1',
      }),
    ).toThrow();
    expect(() =>
      parseAuthConfig({
        AUTH_RP_ID: 'example.com',
        AUTH_ORIGIN: 'https://other.example',
        AUTH_DANGEROUSLY_USE_MEMORY_STORE: '1',
      }),
    ).toThrow('AUTH_ORIGIN hostname');
    expect(() =>
      parseAuthConfig({
        AUTH_RP_ID: 'example.com',
        AUTH_ORIGIN: 'https://example.com',
        AUTH_DATABASE_URL: 'https://database.example',
      }),
    ).toThrow('PostgreSQL');
    expect(() =>
      parseAuthConfig({
        AUTH_DANGEROUSLY_USE_MEMORY_STORE: '1',
        AUTH_PENDING_ACCOUNT_RETENTION_MS: '299999',
      }),
    ).toThrow();
    expect(() =>
      parseAuthConfig({
        AUTH_DANGEROUSLY_USE_MEMORY_STORE: '1',
        AUTH_CLEANUP_BATCH_SIZE: '5001',
      }),
    ).toThrow();
  });

  it('requires hostname-verifying PostgreSQL TLS for remote production databases', () => {
    expect(
      parseAuthConfig({
        NODE_ENV: 'production',
        AUTH_RP_ID: 'woke.social',
        AUTH_ORIGIN: 'https://auth.woke.social',
        AUTH_DATABASE_URL:
          'postgresql://authentication:secret@db.woke.social/auth?sslmode=verify-full',
      }),
    ).toMatchObject({
      databaseUrl: 'postgresql://authentication:secret@db.woke.social/auth?sslmode=verify-full',
    });

    for (const databaseUrl of [
      'postgresql://authentication:secret@db.woke.social/auth',
      'postgresql://authentication:secret@db.woke.social/auth?sslmode=require',
      'postgresql://authentication:secret@db.woke.social/auth?sslmode=verify-ca',
      'postgresql://authentication:secret@db.woke.social/auth?sslmode=verify-full&sslmode=disable',
      'postgresql://authentication:secret@127.0.0.1:5432/auth',
    ]) {
      expect(() =>
        parseAuthConfig({
          NODE_ENV: 'production',
          AUTH_RP_ID: 'woke.social',
          AUTH_ORIGIN: 'https://auth.woke.social',
          AUTH_DATABASE_URL: databaseUrl,
        }),
      ).toThrow(/exactly one sslmode=verify-full/u);
    }
    for (const databaseUrl of [
      'postgresql://authentication:secret@db.staging.woke.social/auth',
      'postgresql://authentication:secret@localhost:5432/auth',
    ]) {
      expect(() =>
        parseAuthConfig({
          APP_ENV: 'staging',
          AUTH_RP_ID: 'woke.social',
          AUTH_ORIGIN: 'https://auth.woke.social',
          AUTH_DATABASE_URL: databaseUrl,
        }),
      ).toThrow(/exactly one sslmode=verify-full/u);
    }
    for (const appEnvironment of ['staging', 'production'] as const) {
      expect(() =>
        parseAuthConfig({
          APP_ENV: appEnvironment,
          AUTH_DATABASE_URL:
            'postgresql://authentication:secret@db.woke.social/auth?sslmode=verify-full',
          NODE_TLS_REJECT_UNAUTHORIZED: '0',
        }),
      ).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED must not be 0/u);
    }

    expect(
      parseAuthConfig({
        NODE_ENV: 'test',
        AUTH_DATABASE_URL:
          'postgresql://wokesocial:local-development-only@127.0.0.1:5432/wokesocial',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      }),
    ).toMatchObject({
      databaseUrl: 'postgresql://wokesocial:local-development-only@127.0.0.1:5432/wokesocial',
    });
  });

  it.each([
    'AUTH_DATABASE_MIGRATION_URL',
    'MODERATION_DATABASE_MIGRATION_URL',
    'MODERATION_DATABASE_URL',
  ])('rejects %s credentials from the long-running runtime', (variableName) => {
    expect(() =>
      parseAuthConfig({
        AUTH_DATABASE_URL: 'postgresql://auth_runtime:secret@localhost/wokesocial',
        [variableName]: 'postgresql://unrelated_migration:migration-secret@localhost/wokesocial',
      }),
    ).toThrow('Privileged database credentials must not be injected');
  });

  it('uses one canonical 1023-byte credential-ID bound across every layer', () => {
    const maximum = Buffer.alloc(1_023, 1).toString('base64url');
    const oversized = Buffer.alloc(1_024, 1).toString('base64url');
    expect(maximum).toHaveLength(1_364);
    expect(credentialIdParamSchema.safeParse(maximum).success).toBe(true);
    expect(credentialIdParamSchema.safeParse(oversized).success).toBe(false);
    expect(credentialIdParamSchema.safeParse('AB').success).toBe(false);
  });

  it('rejects sensitive fields at any supported nesting depth', () => {
    for (const input of [
      { prf: { enabled: true } },
      { wrapper: [{ prf_output: 'secret' }] },
      { privateKey: 'secret' },
      { account_key_seed: 'secret' },
      { nested: { plaintextKey: 'secret' } },
    ]) {
      expect(() => assertNoClientKeyMaterial(input)).toThrow(
        'Client key material and WebAuthn PRF results are not accepted',
      );
    }
    expect(() =>
      assertNoClientKeyMaterial({
        encryptedKey: { ciphertext: 'opaque' },
        publicKey: 'public',
      }),
    ).not.toThrow();
  });

  it('uses opaque session IDs and independently hashed random secrets', () => {
    const sessionId = randomSessionId();
    const first = randomToken();
    const second = randomToken();
    const cookie = sessionCookieValue(sessionId, first);
    expect(sessionId).toMatch(/^ses_[A-Za-z0-9_-]{22}$/u);
    expect(parseSessionCookie(cookie)).toEqual({ sessionId, secret: first });
    expect(parseSessionCookie(`${cookie}.extra`)).toBeUndefined();
    expect(parseSessionCookie('not-a-session')).toBeUndefined();
    expect(equalHash(hashSecret(first), hashSecret(first))).toBe(true);
    expect(equalHash(hashSecret(first), hashSecret(second))).toBe(false);
  });
});
