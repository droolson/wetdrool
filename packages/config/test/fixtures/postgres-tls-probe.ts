import postgres from 'postgres';

import { migrateAuth } from '../../../../apps/auth-service/src/migrate.ts';
import { migrate } from '../../../../apps/indexer/src/migrate.ts';
import { migrateModeration } from '../../../../apps/moderation-service/src/migrate.ts';

const [mode, databaseUrl] = process.argv.slice(2);
if ((mode !== 'query' && mode !== 'migrate') || databaseUrl === undefined) {
  throw new Error('Usage: postgres-tls-probe <query|migrate> <database-url>');
}

try {
  if (mode === 'migrate') {
    await migrateAuth(databaseUrl);
    await migrate(databaseUrl);
    await migrateModeration(databaseUrl);
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
  });
  try {
    const [transport] = await sql<{ ssl: boolean }[]>`
      SELECT ssl
      FROM pg_stat_ssl
      WHERE pid = pg_backend_pid()
    `;
    if (transport?.ssl !== true) {
      throw new Error('PostgreSQL transport is not using TLS.');
    }
    if (mode === 'migrate') {
      const [ledgers] = await sql<
        {
          auth: number;
          indexer: number;
          moderation: number;
        }[]
      >`
        SELECT
          (SELECT count(*)::integer FROM auth_schema_migrations) AS auth,
          (SELECT count(*)::integer FROM schema_migrations) AS indexer,
          (SELECT count(*)::integer FROM moderation_schema_migrations) AS moderation
      `;
      if (
        ledgers === undefined ||
        ledgers.auth < 1 ||
        ledgers.indexer < 1 ||
        ledgers.moderation < 1
      ) {
        throw new Error('One or more migration ledgers are empty.');
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  process.stdout.write(`${JSON.stringify({ ok: true, mode, ssl: true })}\n`);
} catch (error) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : error instanceof Error
        ? error.name
        : 'UnknownError';
  process.stdout.write(`${JSON.stringify({ ok: false, code })}\n`);
  process.exitCode = 2;
}
