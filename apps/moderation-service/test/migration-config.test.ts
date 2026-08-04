import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { readModerationMigrationDatabaseUrl } from '../src/migrate.js';

describe('moderation migration configuration', () => {
  it('requires the dedicated migration role instead of falling back to the runtime role', () => {
    const migrationUrl =
      'postgresql://moderation_migration:migration-secret@database.test/wetdrool';
    expect(
      readModerationMigrationDatabaseUrl({
        MODERATION_DATABASE_URL:
          'postgresql://moderation_runtime:runtime-secret@database.test/wetdrool',
        MODERATION_DATABASE_MIGRATION_URL: migrationUrl,
      }),
    ).toBe(migrationUrl);
    expect(() =>
      readModerationMigrationDatabaseUrl({
        MODERATION_DATABASE_URL:
          'postgresql://moderation_runtime:runtime-secret@database.test/wetdrool',
      }),
    ).toThrow('MODERATION_DATABASE_MIGRATION_URL is required');
    expect(() =>
      readModerationMigrationDatabaseUrl({
        MODERATION_DATABASE_MIGRATION_URL: 'https://database.test/wetdrool',
      }),
    ).toThrow('must use postgres:// or postgresql://');
  });

  it('redacts a malformed credential-bearing URL from deep errors and CLI stderr', () => {
    const sentinel = 'moderation-migration-password-SENTINEL';
    const malformed = `postgresql://moderation_migration:${sentinel}@[invalid`;
    let thrown: unknown;
    try {
      readModerationMigrationDatabaseUrl({
        MODERATION_DATABASE_MIGRATION_URL: malformed,
      });
    } catch (error) {
      thrown = error;
    }
    expect(inspect(thrown, { depth: Number.POSITIVE_INFINITY })).toContain(
      'MODERATION_DATABASE_MIGRATION_URL must be a valid PostgreSQL URL',
    );
    expect(inspect(thrown, { depth: Number.POSITIVE_INFINITY })).not.toContain(sentinel);

    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/migrate.ts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_ENV: 'development',
        MODERATION_DATABASE_MIGRATION_URL: malformed,
        NODE_ENV: 'development',
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'MODERATION_DATABASE_MIGRATION_URL must be a valid PostgreSQL URL',
    );
    expect(result.stderr).not.toContain(sentinel);
  });

  it('requires exact hostname-verifying TLS in every nonlocal deployment mode', () => {
    expect(
      readModerationMigrationDatabaseUrl({
        APP_ENV: 'production',
        MODERATION_DATABASE_MIGRATION_URL:
          'postgresql://moderation_migration:secret@database.test/wetdrool?sslmode=verify-full',
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
        readModerationMigrationDatabaseUrl({
          APP_ENV: 'production',
          MODERATION_DATABASE_MIGRATION_URL: `postgresql://moderation_migration:secret@database.test/wetdrool${sslQuery}`,
        }),
      ).toThrow('must set exactly one sslmode=verify-full');
    }
    for (const environment of [
      { APP_ENV: 'staging' },
      { APP_ENV: 'development', NODE_ENV: 'production' },
    ]) {
      expect(() =>
        readModerationMigrationDatabaseUrl({
          ...environment,
          MODERATION_DATABASE_MIGRATION_URL:
            'postgresql://moderation_migration:secret@database.test/wetdrool',
        }),
      ).toThrow('must set exactly one sslmode=verify-full');
    }
    expect(() =>
      readModerationMigrationDatabaseUrl({
        APP_ENV: 'staging',
        MODERATION_DATABASE_MIGRATION_URL:
          'postgresql://moderation_migration:secret@database.test/wetdrool?sslmode=verify-full',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      }),
    ).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED must not be 0/u);
  });

  it('allows a non-TLS loopback migration role only in development or test', () => {
    expect(
      readModerationMigrationDatabaseUrl({
        NODE_ENV: 'test',
        MODERATION_DATABASE_MIGRATION_URL:
          'postgresql://moderation_migration:secret@localhost:5432/wetdrool',
      }),
    ).toContain('localhost');
  });

  it('keeps schema mutation out of the long-running server and takes one session lock first', async () => {
    const [serverSource, migrationSource] = await Promise.all([
      readFile(new URL('../src/server.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/migrate.ts', import.meta.url), 'utf8'),
    ]);
    expect(serverSource).not.toContain("from './migrate.js'");
    expect(serverSource).not.toContain('migrateModeration(');
    expect(migrationSource).not.toContain('pg_advisory_xact_lock');
    expect(migrationSource.indexOf('pg_advisory_lock(')).toBeGreaterThan(-1);
    expect(migrationSource.indexOf('pg_advisory_lock(')).toBeLessThan(
      migrationSource.indexOf('CREATE TABLE IF NOT EXISTS moderation_schema_migrations'),
    );
  });
});
