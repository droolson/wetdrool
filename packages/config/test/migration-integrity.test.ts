import { describe, expect, it } from 'vitest';

import {
  assertMigrationLedgerIntegrity,
  calculateMigrationChecksum,
} from '../src/migration-integrity.ts';

describe('migration ledger integrity', () => {
  it('computes stable lowercase SHA-256 checksums', () => {
    expect(calculateMigrationChecksum('SELECT 1;\n')).toBe(
      'b4e0497804e46e0a0b0b8c31975b062152d551bac49c3c2e80932567b4085dcd',
    );
  });

  it('accepts an exact checksum and rejects modified migration content', () => {
    const originalChecksum = calculateMigrationChecksum('CREATE TABLE example (id bigint);\n');
    const modifiedChecksum = calculateMigrationChecksum(
      'CREATE TABLE example (id bigint);\n-- modified after application\n',
    );
    expect(() =>
      assertMigrationLedgerIntegrity(
        [{ version: '0001_example.sql', checksum: originalChecksum }],
        [{ version: '0001_example.sql', checksum: originalChecksum }],
        'test_schema_migrations',
      ),
    ).not.toThrow();
    expect(() =>
      assertMigrationLedgerIntegrity(
        [{ version: '0001_example.sql', checksum: modifiedChecksum }],
        [{ version: '0001_example.sql', checksum: originalChecksum }],
        'test_schema_migrations',
      ),
    ).toThrow(/checksum does not match/u);
  });

  it('refuses untrusted legacy rows and non-prefix applied histories', () => {
    const checksum = calculateMigrationChecksum('SELECT 1;\n');
    expect(() =>
      assertMigrationLedgerIntegrity(
        [{ version: '0001_example.sql', checksum }],
        [{ version: '0001_example.sql', checksum: null }],
        'test_schema_migrations',
      ),
    ).toThrow(/automatic backfill is refused/u);
    expect(() =>
      assertMigrationLedgerIntegrity(
        [{ version: '0001_example.sql', checksum }],
        [{ version: '0000_unknown.sql', checksum }],
        'test_schema_migrations',
      ),
    ).toThrow(/exact ordered prefix/u);
    expect(() =>
      assertMigrationLedgerIntegrity(
        [
          { version: '0001_example.sql', checksum },
          { version: '0002_example.sql', checksum },
        ],
        [{ version: '0002_example.sql', checksum }],
        'test_schema_migrations',
      ),
    ).toThrow(/exact ordered prefix/u);
    expect(() =>
      assertMigrationLedgerIntegrity(
        [
          { version: '0002_example.sql', checksum },
          { version: '0001_example.sql', checksum },
        ],
        [],
        'test_schema_migrations',
      ),
    ).toThrow(/strictly ordered/u);
    expect(() => assertMigrationLedgerIntegrity([], [], 'test_schema_migrations')).toThrow(
      /no packaged migrations/u,
    );
  });
});
