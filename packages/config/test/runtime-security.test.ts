import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { assertNoMigrationCredentials } from '../src/runtime-security.ts';

describe('long-running runtime credential isolation', () => {
  it.each([
    'DATABASE_MIGRATION_URL',
    'AUTH_DATABASE_MIGRATION_URL',
    'MODERATION_DATABASE_MIGRATION_URL',
    'UNRELATED_DATABASE_MIGRATION_URL',
    'DATABASE_MIGRATION_PASSWORD',
    'AUTH_DATABASE_MIGRATION_PASSWORD',
    'UNRELATED_DATABASE_MIGRATION_PASSWORD',
    'DATABASE_RUNTIME_PASSWORD',
    'AUTH_DATABASE_RUNTIME_PASSWORD',
    'UNRELATED_DATABASE_RUNTIME_PASSWORD',
    'PGPASSWORD',
    'PGPASSFILE',
    'POSTGRES_PASSWORD',
    'POSTGRES_PASSWORD_FILE',
    'AUTH_DATABASE_URL',
    'MODERATION_DATABASE_URL',
    'UNRELATED_DATABASE_URL',
  ])('rejects nonempty %s without reflecting its value', (name) => {
    const sentinel = 'SENTINEL_MIGRATION_CREDENTIAL';
    try {
      assertNoMigrationCredentials({
        [name]: `postgresql://migration:${sentinel}@database.test/wetdrool`,
      });
      throw new Error('Expected migration credential rejection.');
    } catch (error) {
      expect(inspect(error, { depth: null })).not.toContain(sentinel);
    }
  });

  it('ignores absent and empty migration variables', () => {
    expect(() =>
      assertNoMigrationCredentials(
        {
          DATABASE_MIGRATION_URL: '',
          AUTH_DATABASE_MIGRATION_URL: '   ',
          AUTH_DATABASE_RUNTIME_PASSWORD: '',
          PGPASSWORD: '   ',
          POSTGRES_PASSWORD: '',
          DATABASE_URL: 'postgresql://runtime:secret@database.test/wetdrool',
        },
        { allowedRuntimeUrls: ['DATABASE_URL'] },
      ),
    ).not.toThrow();
  });

  it('allows only the runtime URL explicitly scoped to the calling service', () => {
    expect(() =>
      assertNoMigrationCredentials(
        {
          AUTH_DATABASE_URL: 'postgresql://auth:secret@database.test/wetdrool',
        },
        { allowedRuntimeUrls: ['AUTH_DATABASE_URL'] },
      ),
    ).not.toThrow();
    expect(() =>
      assertNoMigrationCredentials(
        {
          AUTH_DATABASE_URL: 'postgresql://auth:secret@database.test/wetdrool',
          MODERATION_DATABASE_URL: 'postgresql://moderation:secret@database.test/wetdrool',
        },
        { allowedRuntimeUrls: ['AUTH_DATABASE_URL'] },
      ),
    ).toThrow('Privileged database credentials must not be injected');
  });
});
