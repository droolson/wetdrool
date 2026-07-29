import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { readAuthMigrationDatabaseUrl } from '../src/migrate.js';

describe('authentication migration configuration', () => {
  it('requires the dedicated migration role instead of falling back to the runtime role', () => {
    const migrationUrl = 'postgresql://auth_migration:migration-secret@database.test/wokesocial';
    expect(
      readAuthMigrationDatabaseUrl({
        AUTH_DATABASE_URL: 'postgresql://auth_runtime:runtime-secret@database.test/wokesocial',
        AUTH_DATABASE_MIGRATION_URL: migrationUrl,
      }),
    ).toBe(migrationUrl);
    expect(() =>
      readAuthMigrationDatabaseUrl({
        AUTH_DATABASE_URL: 'postgresql://auth_runtime:runtime-secret@database.test/wokesocial',
      }),
    ).toThrow('AUTH_DATABASE_MIGRATION_URL is required');
    expect(() =>
      readAuthMigrationDatabaseUrl({
        AUTH_DATABASE_MIGRATION_URL: 'https://database.test/wokesocial',
      }),
    ).toThrow('must use postgres:// or postgresql://');
  });

  it('redacts a malformed credential-bearing URL from deep errors and CLI stderr', () => {
    const sentinel = 'auth-migration-password-SENTINEL';
    const malformed = `postgresql://auth_migration:${sentinel}@[invalid`;
    let thrown: unknown;
    try {
      readAuthMigrationDatabaseUrl({ AUTH_DATABASE_MIGRATION_URL: malformed });
    } catch (error) {
      thrown = error;
    }
    expect(inspect(thrown, { depth: Number.POSITIVE_INFINITY })).toContain(
      'AUTH_DATABASE_MIGRATION_URL must be a valid PostgreSQL URL',
    );
    expect(inspect(thrown, { depth: Number.POSITIVE_INFINITY })).not.toContain(sentinel);

    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/migrate.ts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_ENV: 'development',
        AUTH_DATABASE_MIGRATION_URL: malformed,
        NODE_ENV: 'development',
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('AUTH_DATABASE_MIGRATION_URL must be a valid PostgreSQL URL');
    expect(result.stderr).not.toContain(sentinel);
  });

  it('requires exact hostname-verifying TLS in every nonlocal deployment mode', () => {
    expect(
      readAuthMigrationDatabaseUrl({
        APP_ENV: 'production',
        AUTH_DATABASE_MIGRATION_URL:
          'postgresql://auth_migration:secret@database.test/wokesocial?sslmode=verify-full',
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
        readAuthMigrationDatabaseUrl({
          APP_ENV: 'production',
          AUTH_DATABASE_MIGRATION_URL: `postgresql://auth_migration:secret@database.test/wokesocial${sslQuery}`,
        }),
      ).toThrow('must set exactly one sslmode=verify-full');
    }
    for (const environment of [
      { APP_ENV: 'staging' },
      { APP_ENV: 'development', NODE_ENV: 'production' },
    ]) {
      expect(() =>
        readAuthMigrationDatabaseUrl({
          ...environment,
          AUTH_DATABASE_MIGRATION_URL:
            'postgresql://auth_migration:secret@database.test/wokesocial',
        }),
      ).toThrow('must set exactly one sslmode=verify-full');
    }
    expect(() =>
      readAuthMigrationDatabaseUrl({
        APP_ENV: 'staging',
        AUTH_DATABASE_MIGRATION_URL:
          'postgresql://auth_migration:secret@database.test/wokesocial?sslmode=verify-full',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      }),
    ).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED must not be 0/u);
  });

  it('allows a non-TLS loopback migration role only in development or test', () => {
    expect(
      readAuthMigrationDatabaseUrl({
        NODE_ENV: 'test',
        AUTH_DATABASE_MIGRATION_URL: 'postgresql://auth_migration:secret@127.0.0.1:5432/wokesocial',
      }),
    ).toContain('127.0.0.1');
  });

  it('keeps schema mutation out of the long-running server and takes one session lock first', async () => {
    const [serverSource, migrationSource] = await Promise.all([
      readFile(new URL('../src/server.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/migrate.ts', import.meta.url), 'utf8'),
    ]);
    expect(serverSource).not.toContain("from './migrate.js'");
    expect(serverSource).not.toContain('migrateAuth(');
    expect(migrationSource).not.toContain('pg_advisory_xact_lock');
    expect(migrationSource.indexOf('pg_advisory_lock(')).toBeGreaterThan(-1);
    expect(migrationSource.indexOf('pg_advisory_lock(')).toBeLessThan(
      migrationSource.indexOf('CREATE TABLE IF NOT EXISTS auth_schema_migrations'),
    );
  });
});
