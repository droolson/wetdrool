import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl =
  process.env['INDEXER_INTEGRATION_ADMIN_DATABASE_URL'] ??
  'postgresql://wokesocial:local-development-only@127.0.0.1:5432/wokesocial';
const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

describe('0013 identity deactivation migration', () => {
  it('backfills a retained deactivation and its exact sequence provenance from 0012', async () => {
    const schema = `indexer_0013_${randomBytes(8).toString('hex')}`;
    const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
    const networkId = 'wokenet:v1:migration-genesis:migration-program';
    const identityId = `wokesocialid:v1:${networkId}:migration-identity`;
    const createdAt = new Date('2026-07-28T12:00:01.000Z');

    try {
      await sql.unsafe(`CREATE SCHEMA "${schema}"`);
      await sql.unsafe(`SET search_path TO "${schema}", wokesocial_indexer, public`);
      const files = (await readdir(migrationDirectory))
        .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
        .sort();
      const migration0013 = files.find((file) => file.startsWith('0013_'));
      expect(migration0013).toBeDefined();
      for (const file of files.filter((candidate) => candidate < (migration0013 ?? ''))) {
        await sql.unsafe(await readFile(join(migrationDirectory, file), 'utf8'));
      }

      await sql`
        INSERT INTO identities (
          identity_id, network_id, identity_address, root_authority,
          root_rotation_count, created_slot, created_at, updated_slot, updated_at
        ) VALUES (
          ${identityId}, ${networkId}, 'migration-identity', 'migration-root',
          0, 1, ${createdAt}, 1, ${createdAt}
        )
      `;
      await insertRawEvent(sql, {
        networkId,
        signature: 'creation-signature',
        index: 0,
        slot: 1,
        type: 'identity-created',
        body: { identityId },
      });
      await insertRawEvent(sql, {
        networkId,
        signature: 'post-signature',
        index: 1,
        slot: 2,
        type: 'post-published',
        body: { identityId, sequence: '1' },
      });
      await insertRawEvent(sql, {
        networkId,
        signature: 'follow-signature',
        index: 2,
        slot: 3,
        type: 'follow-changed',
        body: { followerIdentityId: identityId, followerSequence: '2', edgeStateSequence: '1' },
      });
      await insertRawEvent(sql, {
        networkId,
        signature: 'delegation-signature',
        index: 3,
        slot: 4,
        type: 'delegation-created',
        body: { identityId, identitySequence: '3' },
      });
      await insertRawEvent(sql, {
        networkId,
        signature: 'deactivation-signature',
        index: 4,
        slot: 5,
        type: 'identity-deactivated',
        body: { identityId, identitySequence: '4' },
      });

      await sql.unsafe(await readFile(join(migrationDirectory, migration0013 ?? ''), 'utf8'));

      const rows = await sql<
        {
          active: boolean;
          identity_sequence: string;
          sequence_slot: string;
          sequence_transaction_index: number | null;
          sequence_transaction_signature: string;
          sequence_log_index: number;
          deactivated_slot: string | null;
          deactivated_at: Date | string | null;
          deactivated_transaction_index: number | null;
          deactivated_transaction_signature: string | null;
          deactivated_log_index: number | null;
        }[]
      >`
        SELECT
          active,
          identity_sequence::text,
          sequence_slot::text,
          sequence_transaction_index,
          sequence_transaction_signature,
          sequence_log_index,
          deactivated_slot::text,
          deactivated_at,
          deactivated_transaction_index,
          deactivated_transaction_signature,
          deactivated_log_index
        FROM identities
        WHERE identity_id = ${identityId}
      `;
      expect(rows).toEqual([
        {
          active: false,
          identity_sequence: '4',
          sequence_slot: '5',
          sequence_transaction_index: 4,
          sequence_transaction_signature: 'deactivation-signature',
          sequence_log_index: 0,
          deactivated_slot: '5',
          deactivated_at: new Date('2026-07-28T12:00:05.000Z'),
          deactivated_transaction_index: 4,
          deactivated_transaction_signature: 'deactivation-signature',
          deactivated_log_index: 0,
        },
      ]);
      await expect(
        sql`UPDATE identities SET active = true WHERE identity_id = ${identityId}`,
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await sql.unsafe('SET search_path TO public');
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end({ timeout: 5 });
    }
  });

  it.each([
    {
      name: 'malformed sequence',
      deactivationSequence: 'not-a-sequence',
      deactivationSlot: 5,
    },
    {
      name: 'out-of-order position',
      deactivationSequence: '4',
      deactivationSlot: 3,
    },
    {
      name: 'gapped sequence',
      deactivationSequence: '100',
      deactivationSlot: 5,
    },
  ])('rolls back the migration for a retained $name', async (fixture) => {
    const schema = `indexer_0013_invalid_${randomBytes(8).toString('hex')}`;
    const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
    const networkId = 'wokenet:v1:migration-invalid-genesis:migration-invalid-program';
    const identityId = `wokesocialid:v1:${networkId}:migration-invalid-identity`;
    const createdAt = new Date('2026-07-28T12:00:01.000Z');

    try {
      await sql.unsafe(`CREATE SCHEMA "${schema}"`);
      await sql.unsafe(`SET search_path TO "${schema}", wokesocial_indexer, public`);
      const files = (await readdir(migrationDirectory))
        .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
        .sort();
      const migration0013 = files.find((file) => file.startsWith('0013_'));
      expect(migration0013).toBeDefined();
      for (const file of files.filter((candidate) => candidate < (migration0013 ?? ''))) {
        await sql.unsafe(await readFile(join(migrationDirectory, file), 'utf8'));
      }

      await sql`
        INSERT INTO identities (
          identity_id, network_id, identity_address, root_authority,
          root_rotation_count, created_slot, created_at, updated_slot, updated_at
        ) VALUES (
          ${identityId}, ${networkId}, 'migration-invalid-identity', 'migration-invalid-root',
          0, 1, ${createdAt}, 1, ${createdAt}
        )
      `;
      await insertRawEvent(sql, {
        networkId,
        signature: 'invalid-creation-signature',
        index: 0,
        slot: 1,
        type: 'identity-created',
        body: { identityId },
      });
      await insertRawEvent(sql, {
        networkId,
        signature: 'invalid-delegation-signature',
        index: 3,
        slot: 4,
        type: 'delegation-created',
        body: { identityId, identitySequence: '3' },
      });
      await insertRawEvent(sql, {
        networkId,
        signature: 'invalid-deactivation-signature',
        index: 4,
        slot: fixture.deactivationSlot,
        type: 'identity-deactivated',
        body: { identityId, identitySequence: fixture.deactivationSequence },
      });

      await expect(
        sql.unsafe(await readFile(join(migrationDirectory, migration0013 ?? ''), 'utf8')),
      ).rejects.toMatchObject({ code: '23514' });
      const addedColumns = await sql<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM information_schema.columns
        WHERE table_schema = ${schema}
          AND table_name = 'identities'
          AND column_name = 'active'
      `;
      expect(addedColumns).toEqual([{ count: 0 }]);
    } finally {
      await sql.unsafe('SET search_path TO public');
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end({ timeout: 5 });
    }
  });
});

async function insertRawEvent(
  sql: ReturnType<typeof postgres>,
  input: {
    readonly networkId: string;
    readonly signature: string;
    readonly index: number;
    readonly slot: number;
    readonly type: string;
    readonly body: Readonly<Record<string, string>>;
  },
): Promise<void> {
  await sql`
    INSERT INTO protocol_events (
      network_id, transaction_signature, transaction_index, log_index,
      slot, block_time, event_type, event_body
    ) VALUES (
      ${input.networkId}, ${input.signature}, ${input.index}, 0,
      ${input.slot}, ${new Date(Date.UTC(2026, 6, 28, 12, 0, input.slot))},
      ${input.type}, ${sql.json(input.body)}
    )
  `;
}
