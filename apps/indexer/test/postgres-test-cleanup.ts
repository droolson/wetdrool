import postgres from 'postgres';

import type { ProjectionStore } from '../src/projection.js';

/**
 * Integration-test-only operator purge. Production runtime code intentionally
 * cannot delete or rewrite the immutable raw event ledger.
 */
export async function purgePostgresTestNetworks(
  projection: Pick<ProjectionStore, 'clearProjection'>,
  migrationDatabaseUrl: string,
  networkIds: readonly string[],
): Promise<void> {
  const networks = [...new Set(networkIds)].sort();
  for (const networkId of networks) {
    await projection.clearProjection(networkId);
  }

  const sql = postgres(migrationDatabaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });
  try {
    for (const networkId of networks) {
      await sql.begin(async (transaction) => {
        await transaction`
          SELECT pg_advisory_xact_lock(hashtextextended(${networkId}, 0))
        `;
        await transaction`
          DELETE FROM indexer_dead_letters
          WHERE network_id = ${networkId}
        `;
        await transaction`
          DELETE FROM protocol_events
          WHERE network_id = ${networkId}
        `;
      });
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
