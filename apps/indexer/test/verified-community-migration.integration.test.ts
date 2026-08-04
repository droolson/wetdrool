import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import bs58 from 'bs58';
import postgres, { type Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl =
  process.env['INDEXER_INTEGRATION_ADMIN_DATABASE_URL'] ??
  'postgresql://wetdrool:local-development-only@127.0.0.1:5432/wetdrool';
const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

describe('0018 predeployment ABI reset boundary', () => {
  it.each(['community-created', 'community-membership-changed', 'proposal-created'] as const)(
    'refuses a legacy %s raw event instead of creating an unreplayable ledger',
    async (eventType) => {
      await withPre0018Schema(async (sql, migration0018, schema) => {
        await sql`
        INSERT INTO protocol_events (
          network_id, transaction_signature, transaction_index, log_index, slot,
          block_time, event_type, event_body, manifest_pending,
          terminal_manifest_failure_code
        ) VALUES (
          ${`droolnet:v1:${publicKey()}:${publicKey()}`},
          ${bs58.encode(randomBytes(64))}, 0, 0, 1,
          '2026-07-29T12:00:00.000Z', ${eventType},
          ${sql.json({ type: eventType })}, false, null
        )
      `;

        await expect(sql.unsafe(migration0018)).rejects.toThrow(
          /0018 changes the predeployment community, membership, and proposal ABI/u,
        );
        await expect(
          sql<{ count: string }[]>`
          SELECT count(*)::text AS count
          FROM information_schema.columns
          WHERE table_schema = ${schema}
            AND table_name = 'communities'
            AND column_name = 'membership_policy_sequence'
        `,
        ).resolves.toEqual([{ count: '0' }]);
      });
    },
  );

  it('refuses a legacy projection row even when its raw event is absent', async () => {
    await withPre0018Schema(async (sql, migration0018) => {
      const networkId = `droolnet:v1:${publicKey()}:${publicKey()}`;
      const identityAddress = publicKey();
      const creatorIdentityId = `wetdroolid:v1:${networkId}:${identityAddress}`;
      const rootAuthority = publicKey();
      const transactionSignature = bs58.encode(randomBytes(64));
      await sql`
        INSERT INTO identities (
          identity_id, network_id, identity_address, root_authority,
          root_rotation_count, active, identity_sequence,
          sequence_slot, sequence_transaction_index,
          sequence_transaction_signature, sequence_log_index,
          created_slot, created_at, updated_slot, updated_at
        ) VALUES (
          ${creatorIdentityId}, ${networkId}, ${identityAddress}, ${rootAuthority},
          0, true, 0, 1, 0, ${transactionSignature}, 0,
          1, '2026-07-29T12:00:00.000Z',
          1, '2026-07-29T12:00:00.000Z'
        )
      `;
      await sql`
        INSERT INTO communities (
          community_address, network_id, creator_identity_id,
          manifest_authority, latest_action_authority,
          creator_sequence, manifest_cid, manifest_hash, manifest_verified,
          manifest_governance_version, manifest_governance_strategy_hash,
          governance_version, governance_strategy_hash,
          created_slot, created_at, updated_slot, updated_at
        ) VALUES (
          ${publicKey()}, ${networkId},
          ${creatorIdentityId}, ${rootAuthority}, ${rootAuthority},
          1, 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
          'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', false,
          1, 'uwm8vfQxM7tZkfr0DZsEnFVxa4ZgsIPg8DsCn-xbX_HA',
          1, 'uwm8vfQxM7tZkfr0DZsEnFVxa4ZgsIPg8DsCn-xbX_HA',
          1, '2026-07-29T12:00:00.000Z',
          1, '2026-07-29T12:00:00.000Z'
        )
      `;

      await expect(sql.unsafe(migration0018)).rejects.toThrow(
        /discard the disposable PostgreSQL projection and local-validator ledger/u,
      );
    });
  });

  it('applies to a clean predeployment schema and creates the strict v2 columns', async () => {
    await withPre0018Schema(async (sql, migration0018, schema) => {
      await expect(sql.unsafe(migration0018)).resolves.toBeDefined();
      const columns = await sql<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = ${schema}
          AND (
            (table_name = 'communities'
              AND column_name IN (
                'visibility',
                'membership_policy',
                'membership_policy_sequence',
                'membership_sequence'
              ))
            OR
            (table_name = 'community_memberships'
              AND column_name IN (
                'action',
                'state',
                'member_action_sequence',
                'community_membership_sequence',
                'manifest_hash'
              ))
            OR
            (table_name = 'governance_proposals'
              AND column_name = 'community_membership_sequence')
          )
        ORDER BY table_name, column_name
      `;
      expect(columns).toEqual([
        { table_name: 'communities', column_name: 'membership_policy' },
        { table_name: 'communities', column_name: 'membership_policy_sequence' },
        { table_name: 'communities', column_name: 'membership_sequence' },
        { table_name: 'communities', column_name: 'visibility' },
        { table_name: 'community_memberships', column_name: 'action' },
        {
          table_name: 'community_memberships',
          column_name: 'community_membership_sequence',
        },
        { table_name: 'community_memberships', column_name: 'manifest_hash' },
        { table_name: 'community_memberships', column_name: 'member_action_sequence' },
        { table_name: 'community_memberships', column_name: 'state' },
        {
          table_name: 'governance_proposals',
          column_name: 'community_membership_sequence',
        },
      ]);
    });
  });
});

async function withPre0018Schema(
  exercise: (sql: Sql, migration0018: string, schema: string) => Promise<void>,
): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
    .sort();
  const migration0018File = files.find((file) => file.startsWith('0018_'));
  if (migration0018File === undefined) {
    throw new Error('Expected migration 0018 in the checked-in catalog.');
  }
  const schema = `indexer_0018_${randomBytes(8).toString('hex')}`;
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

  try {
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    await sql.unsafe(`SET search_path TO "${schema}", wetdrool_indexer, pg_catalog`);
    for (const file of files.filter((candidate) => candidate < migration0018File)) {
      await sql.unsafe(await readFile(join(migrationDirectory, file), 'utf8'));
    }
    await exercise(
      sql,
      await readFile(join(migrationDirectory, migration0018File), 'utf8'),
      schema,
    );
  } finally {
    await sql.unsafe('SET search_path TO wetdrool_indexer, pg_catalog').catch(() => undefined);
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await sql.end({ timeout: 5 });
  }
}

function publicKey(): string {
  return bs58.encode(randomBytes(32));
}
