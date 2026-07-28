import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { repositoryRoot } from './workspaces.mjs';

const action = process.argv[2];
const allowedActions = new Set(['config', 'down', 'logs', 'ps', 'restart', 'up']);

if (!allowedActions.has(action)) {
  console.error('usage: node scripts/infra.mjs <config|up|down|restart|ps|logs>');
  process.exit(2);
}

const envFile = existsSync(join(repositoryRoot, '.env'))
  ? join(repositoryRoot, '.env')
  : join(repositoryRoot, '.env.example');
const composeFile = join(repositoryRoot, 'infra', 'compose.yaml');
const baseArgs = [
  'compose',
  '--env-file',
  envFile,
  '--project-name',
  'wokesocial-local',
  '--file',
  composeFile,
];

const actionArgs = {
  config: ['config', '--quiet'],
  down: ['down', '--remove-orphans'],
  logs: ['logs', '--tail', '200'],
  ps: ['ps'],
  restart: ['restart'],
  up: ['up', '--detach', '--wait', '--remove-orphans'],
}[action];

const result = spawnSync('docker', [...baseArgs, ...actionArgs], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`infra: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
