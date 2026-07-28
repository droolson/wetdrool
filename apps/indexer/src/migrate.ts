import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { readIndexerConfig } from './config.js';

export async function migrate(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  const directory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const files = (await readdir(directory))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
      .sort();

    for (const file of files) {
      const applied = await sql<{ version: string }[]>`
        SELECT version FROM schema_migrations WHERE version = ${file}
      `;
      if (applied.length > 0) {
        continue;
      }
      const migration = await readFile(join(directory, file), 'utf8');
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`
          INSERT INTO schema_migrations (version) VALUES (${file})
        `;
      });
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const config = readIndexerConfig();
  await migrate(config.databaseUrl);
}
