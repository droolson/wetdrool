import { mkdir } from 'node:fs/promises';

import { readIndexerConfig, removeIndexerSetupOnlyVariables } from './config.js';
import { migrate, readMigrationDatabaseUrl } from './migrate.js';

if (process.env['APP_ENV'] === 'production' || process.env['NODE_ENV'] === 'production') {
  throw new Error('The indexer local setup command refuses production runtime modes.');
}

const runtimeEnvironment = { ...process.env };
removeIndexerSetupOnlyVariables(runtimeEnvironment);
const config = readIndexerConfig(runtimeEnvironment);
await mkdir(config.contentStoragePath, { recursive: true, mode: 0o700 });
await migrate(readMigrationDatabaseUrl());
