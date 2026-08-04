import { describe, expect, it } from 'vitest';

import { parseModerationConfig } from '../src/config.js';
import { createModerationStore } from '../src/server.js';

const dataKeys = JSON.stringify({
  activeKeyId: 'v1',
  keys: { v1: Buffer.alloc(32, 7).toString('base64url') },
});
const publicLocalDataKeys = JSON.stringify({
  activeKeyId: 'renamed-local-key',
  keys: { 'renamed-local-key': Buffer.alloc(32, 1).toString('base64url') },
});

describe('moderation configuration', () => {
  it('accepts the canonical wetdrool.com origin and a paired PostgreSQL/key-ring configuration', () => {
    const config = parseModerationConfig({
      NODE_ENV: 'production',
      MODERATION_ALLOWED_ORIGINS: 'https://wetdrool.com',
      MODERATION_DATABASE_URL:
        'postgresql://moderation:secret@db.example/moderation?sslmode=verify-full',
      MODERATION_DATA_KEYS: dataKeys,
      TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
    });
    expect(config.allowedOrigins).toEqual(['https://wetdrool.com']);
    expect(config.databaseUrl).toContain('postgresql://');
    expect(config.keyRing?.activeKeyId).toBe('v1');
    expect(config.trustedProxyCidrs).toEqual(['127.0.0.1/32']);
  });

  it.each([
    'https://droolhouse.com',
    'https://www.droolhouse.com',
    'https://SOCIALLYWOKE.COM.',
    'https://WWW.SOCIALLYWOKE.COM..',
  ])('rejects redirect-only legacy origin %s', (origin) => {
    expect(() =>
      parseModerationConfig({
        NODE_ENV: 'production',
        MODERATION_ALLOWED_ORIGINS: origin,
      }),
    ).toThrow(/legacy redirect hostname/u);
  });

  it('forbids production unverified authorization and insecure remote origins', () => {
    expect(() =>
      parseModerationConfig({
        NODE_ENV: 'production',
        MODERATION_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: '1',
      }),
    ).toThrow(/forbidden in production/u);
    expect(() =>
      parseModerationConfig({
        APP_ENV: 'production',
        MODERATION_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: '1',
      }),
    ).toThrow(/forbidden in production/u);
    expect(() =>
      parseModerationConfig({
        APP_ENV: 'staging',
        MODERATION_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: '1',
      }),
    ).toThrow(/forbidden in production/u);
    expect(() =>
      parseModerationConfig({
        MODERATION_HOST: '0.0.0.0',
        MODERATION_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: '1',
      }),
    ).toThrow(/restricted to loopback/u);
    expect(() =>
      parseModerationConfig({
        NODE_ENV: 'production',
        MODERATION_ALLOWED_ORIGINS: 'http://moderation.example',
      }),
    ).toThrow(/nonlocal HTTPS/u);
    for (const appEnvironment of ['staging', 'production'] as const) {
      expect(() =>
        parseModerationConfig({
          APP_ENV: appEnvironment,
          NODE_ENV: 'development',
          MODERATION_ALLOWED_ORIGINS: 'http://moderation.example',
        }),
      ).toThrow(/nonlocal HTTPS/u);
      for (const origin of [
        'https://localhost',
        'https://moderation.localhost',
        'https://127.0.0.8',
        'https://[::ffff:127.0.0.1]',
        'https://0.0.0.0',
      ]) {
        expect(() =>
          parseModerationConfig({
            APP_ENV: appEnvironment,
            NODE_ENV: 'development',
            MODERATION_ALLOWED_ORIGINS: origin,
          }),
        ).toThrow(/nonlocal HTTPS/u);
      }
    }
  });

  it('requires PostgreSQL and the application data-key ring together', () => {
    expect(() =>
      parseModerationConfig({
        MODERATION_DATABASE_URL: 'postgresql://localhost/moderation',
      }),
    ).toThrow(/configured together/u);
    expect(() => parseModerationConfig({ MODERATION_DATA_KEYS: dataKeys })).toThrow(
      /configured together/u,
    );
  });

  it('rejects the public local-development data key in every nonlocal deployment', () => {
    for (const appEnvironment of ['staging', 'production'] as const) {
      expect(() =>
        parseModerationConfig({
          APP_ENV: appEnvironment,
          NODE_ENV: 'production',
          MODERATION_DATABASE_URL:
            'postgresql://moderation:secret@db.example/moderation?sslmode=verify-full',
          MODERATION_DATA_KEYS: publicLocalDataKeys,
        }),
      ).toThrow(/public local-development data key/u);
    }

    expect(
      parseModerationConfig({
        APP_ENV: 'development',
        NODE_ENV: 'development',
        MODERATION_DATABASE_URL: 'postgresql://moderation:secret@localhost/moderation',
        MODERATION_DATA_KEYS: publicLocalDataKeys,
      }).keyRing?.activeKeyId,
    ).toBe('renamed-local-key');
  });

  it.each([
    'MODERATION_DATABASE_MIGRATION_URL',
    'AUTH_DATABASE_MIGRATION_URL',
    'AUTH_DATABASE_URL',
  ])('rejects %s credentials from the long-running runtime', (variableName) => {
    expect(() =>
      parseModerationConfig({
        [variableName]: 'postgresql://unrelated_migration:migration-secret@localhost/wetdrool',
      }),
    ).toThrow('Privileged database credentials must not be injected');
  });

  it('requires hostname-verifying PostgreSQL TLS for remote production databases', () => {
    for (const databaseUrl of [
      'postgresql://moderation:secret@db.example/moderation',
      'postgresql://moderation:secret@db.example/moderation?sslmode=require',
      'postgresql://moderation:secret@db.example/moderation?sslmode=verify-ca',
      'postgresql://moderation:secret@db.example/moderation?sslmode=verify-full&sslmode=disable',
      'postgresql://moderation:secret@127.0.0.1:5432/moderation',
    ]) {
      expect(() =>
        parseModerationConfig({
          APP_ENV: 'production',
          MODERATION_DATABASE_URL: databaseUrl,
          MODERATION_DATA_KEYS: dataKeys,
        }),
      ).toThrow(/exactly one sslmode=verify-full/u);
    }
    for (const databaseUrl of [
      'postgresql://moderation:secret@db.staging.example/moderation',
      'postgresql://moderation:secret@localhost:5432/moderation',
    ]) {
      expect(() =>
        parseModerationConfig({
          APP_ENV: 'staging',
          MODERATION_DATABASE_URL: databaseUrl,
          MODERATION_DATA_KEYS: dataKeys,
        }),
      ).toThrow(/exactly one sslmode=verify-full/u);
    }
    for (const appEnvironment of ['staging', 'production'] as const) {
      expect(() =>
        parseModerationConfig({
          APP_ENV: appEnvironment,
          MODERATION_DATABASE_URL:
            'postgresql://moderation:secret@db.example/moderation?sslmode=verify-full',
          MODERATION_DATA_KEYS: dataKeys,
          NODE_TLS_REJECT_UNAUTHORIZED: '0',
        }),
      ).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED must not be 0/u);
    }

    expect(
      parseModerationConfig({
        NODE_ENV: 'test',
        MODERATION_DATABASE_URL:
          'postgresql://wetdrool:local-development-only@localhost:5432/wetdrool',
        MODERATION_DATA_KEYS: dataKeys,
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      }),
    ).toMatchObject({
      databaseUrl: 'postgresql://wetdrool:local-development-only@localhost:5432/wetdrool',
    });
  });

  it('normalizes origins before rejecting semantic duplicates', () => {
    expect(() =>
      parseModerationConfig({
        MODERATION_ALLOWED_ORIGINS: 'https://wetdrool.com,https://WOKE.SOCIAL:443/',
      }),
    ).toThrow(/must be unique/u);
  });

  it('leaves production persistence unconfigured for the locked store instead of enabling memory', () => {
    const config = parseModerationConfig({ NODE_ENV: 'production' });
    expect(config.databaseUrl).toBeUndefined();
    expect(config.keyRing).toBeUndefined();
    expect(config.dangerouslyAllowUnverifiedLocalMode).toBe(false);
    expect(config.deploymentPolicy).toBe('nonlocal');
    expect(createModerationStore(config).kind).toBe('locked');
  });

  it.each(['staging', 'production'] as const)(
    'fails closed without persistence when APP_ENV alone selects %s',
    (appEnvironment) => {
      const config = parseModerationConfig({
        APP_ENV: appEnvironment,
        NODE_ENV: 'development',
      });
      expect(config.deploymentPolicy).toBe('nonlocal');
      expect(createModerationStore(config).kind).toBe('locked');
    },
  );

  it('uses the in-memory store only under the derived local deployment policy', () => {
    const config = parseModerationConfig({
      APP_ENV: 'development',
      NODE_ENV: 'development',
    });
    expect(config.deploymentPolicy).toBe('local');
    expect(createModerationStore(config).kind).toBe('memory');
  });
});
