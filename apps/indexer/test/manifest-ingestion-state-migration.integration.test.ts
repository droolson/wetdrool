import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres, { type Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl =
  process.env['INDEXER_INTEGRATION_ADMIN_DATABASE_URL'] ??
  'postgresql://wokesocial:local-development-only@127.0.0.1:5432/wokesocial';
const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

describe('0016 manifest-ingestion-state migration', () => {
  it('fails closed on orphan terminal or pending retry state and accepts an exact raw match', async () => {
    const files = (await readdir(migrationDirectory))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
      .sort();
    const migration0016 = files.find((file) => file.startsWith('0016_'));
    expect(migration0016).toBeDefined();
    const before0016 = files.filter((file) => file < (migration0016 ?? ''));
    const migrationSource = await readFile(join(migrationDirectory, migration0016 ?? ''), 'utf8');
    const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
    const orphanSchema = `indexer_0016_orphan_${randomBytes(8).toString('hex')}`;
    const retrySchema = `indexer_0016_retry_${randomBytes(8).toString('hex')}`;
    const exactSchema = `indexer_0016_exact_${randomBytes(8).toString('hex')}`;

    try {
      await prepareSchemaAt0015(sql, orphanSchema, before0016);
      await sql`
        INSERT INTO indexer_dead_letters (
          network_id, transaction_signature, log_index, event_body,
          failure_code, failure_detail, next_attempt_at
        ) VALUES (
          'migration-network', 'orphan-terminal', 0, '{}'::jsonb,
          'schema-version', 'orphan terminal fixture', null
        )
      `;
      await expect(sql.unsafe(migrationSource)).rejects.toThrow(
        'terminal indexer dead letter does not exactly match a terminal raw protocol event',
      );

      await prepareSchemaAt0015(sql, retrySchema, before0016);
      await sql`
        INSERT INTO indexer_dead_letters (
          network_id, transaction_signature, log_index, event_body,
          failure_code, failure_detail, next_attempt_at
        ) VALUES (
          'migration-network', 'orphan-pending-retry', 0, '{}'::jsonb,
          'manifest-unavailable', 'orphan retry fixture',
          '2026-07-28T12:05:00.000Z'
        )
      `;
      await expect(sql.unsafe(migrationSource)).rejects.toThrow(
        'retryable manifest-unavailable dead letter requires an exactly matching pending raw event',
      );

      await sql.unsafe(`SET search_path TO "${exactSchema}", wokesocial_indexer, pg_catalog`);
      await sql.unsafe(`CREATE SCHEMA "${exactSchema}"`);
      await sql.unsafe(`SET search_path TO "${exactSchema}", wokesocial_indexer, pg_catalog`);
      for (const file of before0016) {
        await sql.unsafe(await readFile(join(migrationDirectory, file), 'utf8'));
      }
      await sql`
        INSERT INTO protocol_events (
          network_id, transaction_signature, transaction_index, log_index, slot,
          block_time, event_type, event_body, terminal_manifest_failure_code
        ) VALUES (
          'migration-network', 'exact-terminal', 0, 0, 1,
          '2026-07-28T12:00:00.000Z', 'profile-updated',
          '{"type":"profile-updated"}'::jsonb, 'schema-version'
        )
      `;
      await sql`
        INSERT INTO indexer_dead_letters (
          network_id, transaction_signature, log_index, event_body,
          failure_code, failure_detail, next_attempt_at
        ) VALUES (
          'migration-network', 'exact-terminal', 0, '{}'::jsonb,
          'schema-version', 'exact terminal fixture', null
        )
      `;
      await expect(sql.unsafe(migrationSource)).resolves.toBeDefined();
      const rows = await sql<
        {
          manifest_pending: boolean;
          terminal_manifest_failure_code: string;
        }[]
      >`
        SELECT manifest_pending, terminal_manifest_failure_code
        FROM protocol_events
        WHERE network_id = 'migration-network'
      `;
      expect(rows).toEqual([
        {
          manifest_pending: false,
          terminal_manifest_failure_code: 'schema-version',
        },
      ]);
    } finally {
      await sql.unsafe('SET search_path TO wokesocial_indexer, pg_catalog').catch(() => undefined);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${orphanSchema}" CASCADE`).catch(() => undefined);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${retrySchema}" CASCADE`).catch(() => undefined);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${exactSchema}" CASCADE`).catch(() => undefined);
      await sql.end({ timeout: 5 });
    }
  }, 30_000);
});

async function prepareSchemaAt0015(
  sql: Sql,
  schema: string,
  migrationFiles: readonly string[],
): Promise<void> {
  await sql.unsafe(`CREATE SCHEMA "${schema}"`);
  await sql.unsafe(`SET search_path TO "${schema}", wokesocial_indexer, pg_catalog`);
  for (const file of migrationFiles) {
    await sql.unsafe(await readFile(join(migrationDirectory, file), 'utf8'));
  }
}
