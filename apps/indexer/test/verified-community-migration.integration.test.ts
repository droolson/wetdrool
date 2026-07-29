import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import bs58 from 'bs58';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl =
  process.env['INDEXER_INTEGRATION_ADMIN_DATABASE_URL'] ??
  'postgresql://wokesocial:local-development-only@127.0.0.1:5432/wokesocial';
const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
const legacyStrategyHash = 'uwm8vfQxM7tZkfr0DZsEnFVxa4ZgsIPg8DsCn-xbX_HA';

describe('0017 verified-community migration', () => {
  it('retains legacy shells and atomically requeues their accepted raw creation events', async () => {
    const files = (await readdir(migrationDirectory))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
      .sort();
    const migration0017 = files.find((file) => file.startsWith('0017_'));
    expect(migration0017).toBeDefined();
    const schema = `indexer_0017_${randomBytes(8).toString('hex')}`;
    const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
    const programId = publicKey();
    const networkId = `wokenet:v1:${publicKey()}:${programId}`;
    const identityAddress = publicKey();
    const identityId = `wokesocialid:v1:${networkId}:${identityAddress}`;
    const rootAuthority = publicKey();
    const communityAddress = publicKey();
    const transactionSignature = bs58.encode(randomBytes(64));
    const createdAt = '2026-07-28T12:00:00.000Z';
    const eventBody = {
      networkId,
      programId,
      transactionSignature,
      transactionIndex: 0,
      slot: '2',
      logIndex: 0,
      blockTime: createdAt,
      finalized: true,
      type: 'community-created',
      communityAddress,
      creatorIdentityId: identityId,
      authority: rootAuthority,
      creatorSequence: '1',
      manifestCid: 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
      manifestHash: 'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      governanceVersion: 1,
      governanceStrategyHash: legacyStrategyHash,
    };

    try {
      await sql.unsafe(`CREATE SCHEMA "${schema}"`);
      await sql.unsafe(`SET search_path TO "${schema}", wokesocial_indexer, pg_catalog`);
      for (const file of files.filter((candidate) => candidate < (migration0017 ?? ''))) {
        await sql.unsafe(await readFile(join(migrationDirectory, file), 'utf8'));
      }
      await sql`
        INSERT INTO identities (
          identity_id, network_id, identity_address, root_authority,
          root_rotation_count, active, identity_sequence,
          sequence_slot, sequence_transaction_index,
          sequence_transaction_signature, sequence_log_index,
          created_slot, created_at, updated_slot, updated_at
        ) VALUES (
          ${identityId}, ${networkId}, ${identityAddress}, ${rootAuthority},
          0, true, 1, 2, 0, ${transactionSignature}, 0,
          1, ${createdAt}, 2, ${createdAt}
        )
      `;
      await sql`
        INSERT INTO communities (
          community_address, network_id, creator_identity_id, authority,
          creator_sequence, manifest_cid, manifest_hash, manifest_verified,
          governance_version, governance_strategy_hash,
          created_slot, created_at, updated_slot, updated_at
        ) VALUES (
          ${communityAddress}, ${networkId}, ${identityId}, ${rootAuthority},
          1, ${eventBody.manifestCid}, ${eventBody.manifestHash}, false,
          1, ${legacyStrategyHash}, 2, ${createdAt}, 2, ${createdAt}
        )
      `;
      await sql`
        INSERT INTO community_governance_history (
          network_id, community_address, governance_version, strategy_hash,
          authority, creator_sequence, updated_slot, updated_at
        ) VALUES (
          ${networkId}, ${communityAddress}, 1, ${legacyStrategyHash},
          ${rootAuthority}, 1, 2, ${createdAt}
        )
      `;
      await sql`
        INSERT INTO protocol_events (
          network_id, transaction_signature, transaction_index, log_index, slot,
          block_time, event_type, event_body, manifest_pending,
          terminal_manifest_failure_code
        ) VALUES (
          ${networkId}, ${transactionSignature}, 0, 0, 2, ${createdAt},
          'community-created', ${sql.json(eventBody)}, false, null
        )
      `;

      await expect(
        sql.unsafe(await readFile(join(migrationDirectory, migration0017 ?? ''), 'utf8')),
      ).resolves.toBeDefined();

      const communities = await sql<
        {
          manifest_verified: boolean;
          object_id: string | null;
          content: unknown | null;
          manifest_authority: string;
          latest_action_authority: string;
          manifest_governance_version: number;
          manifest_governance_strategy_hash: string;
        }[]
      >`
        SELECT
          manifest_verified,
          object_id,
          content,
          manifest_authority,
          latest_action_authority,
          manifest_governance_version,
          manifest_governance_strategy_hash
        FROM communities
        WHERE network_id = ${networkId}
          AND community_address = ${communityAddress}
      `;
      expect(communities).toEqual([
        {
          manifest_verified: false,
          object_id: null,
          content: null,
          manifest_authority: rootAuthority,
          latest_action_authority: rootAuthority,
          manifest_governance_version: 1,
          manifest_governance_strategy_hash: legacyStrategyHash,
        },
      ]);
      const dispositions = await sql<
        {
          manifest_pending: boolean;
          terminal_manifest_failure_code: string | null;
          failure_code: string;
          attempts: number;
          next_attempt_at: Date | string | null;
        }[]
      >`
        SELECT
          event.manifest_pending,
          event.terminal_manifest_failure_code,
          dead.failure_code,
          dead.attempts,
          dead.next_attempt_at
        FROM protocol_events AS event
        JOIN indexer_dead_letters AS dead
          ON dead.network_id = event.network_id
         AND dead.transaction_signature = event.transaction_signature
         AND dead.log_index = event.log_index
        WHERE event.network_id = ${networkId}
      `;
      expect(dispositions).toHaveLength(1);
      expect(dispositions[0]).toMatchObject({
        manifest_pending: true,
        terminal_manifest_failure_code: null,
        failure_code: 'manifest-unavailable',
        attempts: 1,
      });
      expect(dispositions[0]?.next_attempt_at).not.toBeNull();
    } finally {
      await sql.unsafe('SET search_path TO wokesocial_indexer, pg_catalog').catch(() => undefined);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await sql.end({ timeout: 5 });
    }
  }, 30_000);
});

function publicKey(): string {
  return bs58.encode(randomBytes(32));
}
