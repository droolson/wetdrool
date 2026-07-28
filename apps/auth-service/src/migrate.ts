import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { parseAuthConfig } from './config.js';

export async function migrateAuth(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  const directory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS auth_schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const files = (await readdir(directory))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
      .sort();
    for (const file of files) {
      const source = await readFile(join(directory, file), 'utf8');
      await sql.begin(async (transaction) => {
        await transaction`
          SELECT pg_advisory_xact_lock(
            hashtext('wokesocial/auth-service/schema-migrations')
          )
        `;
        const applied = await transaction<{ version: string }[]>`
          SELECT version FROM auth_schema_migrations WHERE version = ${file}
        `;
        if (applied.length > 0) return;
        await transaction.unsafe(source);
        await transaction`
          INSERT INTO auth_schema_migrations (version) VALUES (${file})
        `;
      });
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const config = parseAuthConfig();
  if (config.databaseUrl === undefined) {
    throw new Error('Database migrations require AUTH_DATABASE_URL.');
  }
  await migrateAuth(config.databaseUrl);
}
