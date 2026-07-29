import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres, { type Sql } from 'postgres';

import { assertNodeTlsVerificationPolicy, assertPostgresTlsPolicy } from '@wokesocial/config';
import {
  assertMigrationLedgerIntegrity,
  calculateMigrationChecksum,
} from '@wokesocial/config/migration-integrity';

const MIGRATION_LOCK_NAMESPACE = 0x574f4b45;
const MIGRATION_LOCK_RESOURCE = 0x4d4f4452;

export async function migrateModeration(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  const directory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

  try {
    await sql`
      SELECT pg_advisory_lock(
        ${MIGRATION_LOCK_NAMESPACE}::integer,
        ${MIGRATION_LOCK_RESOURCE}::integer
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS moderation_schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      ALTER TABLE moderation_schema_migrations
      ADD COLUMN IF NOT EXISTS checksum text
    `;
    await revokeLedgerWriteAccess(sql, 'moderation_schema_migrations');
    const files = (await readdir(directory))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
      .sort();
    const migrations = await Promise.all(
      files.map(async (version) => {
        const source = await readFile(join(directory, version), 'utf8');
        return { version, source, checksum: calculateMigrationChecksum(source) };
      }),
    );
    const applied = await sql<{ version: string; checksum: string | null }[]>`
      SELECT version, checksum
      FROM moderation_schema_migrations
      ORDER BY version
    `;
    assertMigrationLedgerIntegrity(migrations, applied, 'moderation_schema_migrations');
    await sql`
      ALTER TABLE moderation_schema_migrations
      ALTER COLUMN checksum SET NOT NULL
    `;
    const appliedVersions = new Set(applied.map((migration) => migration.version));

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration.source);
        await transaction`
          INSERT INTO moderation_schema_migrations (version, checksum)
          VALUES (${migration.version}, ${migration.checksum})
        `;
      });
    }
    await revokeLedgerWriteAccess(sql, 'moderation_schema_migrations');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function revokeLedgerWriteAccess(sql: Sql, tableName: string): Promise<void> {
  await sql`REVOKE INSERT, UPDATE, DELETE ON TABLE ${sql(tableName)} FROM PUBLIC`;
  const grantees = await sql<{ grantee: string }[]>`
    SELECT DISTINCT grantee
    FROM information_schema.role_table_grants
    WHERE table_schema = current_schema()
      AND table_name = ${tableName}
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
      AND grantee <> current_user
      AND grantee <> 'PUBLIC'
  `;
  for (const { grantee } of grantees) {
    await sql`
      REVOKE INSERT, UPDATE, DELETE
      ON TABLE ${sql(tableName)}
      FROM ${sql(grantee)}
    `;
  }
}

export function readModerationMigrationDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const appEnvironment = environment['APP_ENV']?.trim() || 'development';
  if (!['development', 'test', 'staging', 'production'].includes(appEnvironment)) {
    throw new Error('APP_ENV must select development, test, staging, or production.');
  }
  const nodeEnvironment = environment['NODE_ENV']?.trim() || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnvironment)) {
    throw new Error('NODE_ENV must select development, test, or production.');
  }
  const value = environment['MODERATION_DATABASE_MIGRATION_URL']?.trim();
  if (value === undefined || value === '') {
    throw new Error(
      'MODERATION_DATABASE_MIGRATION_URL is required for the explicit moderation migration command.',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('MODERATION_DATABASE_MIGRATION_URL must be a valid PostgreSQL URL.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('MODERATION_DATABASE_MIGRATION_URL must use postgres:// or postgresql://.');
  }
  const tlsRequired =
    appEnvironment === 'staging' ||
    appEnvironment === 'production' ||
    nodeEnvironment === 'production';
  assertNodeTlsVerificationPolicy(environment['NODE_TLS_REJECT_UNAUTHORIZED'], { tlsRequired });
  assertPostgresTlsPolicy(value, {
    tlsRequired,
    variableName: 'MODERATION_DATABASE_MIGRATION_URL',
  });
  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await migrateModeration(readModerationMigrationDatabaseUrl());
}
