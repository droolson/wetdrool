import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { repositoryRoot } from './workspaces.mjs';

const action = process.argv[2];
const allowedActions = new Set(['config', 'down', 'logs', 'ps', 'restart', 'up']);
const allowedProfiles = new Set([
  'indexer',
  'locked-services',
  'media',
  'privilege-probe',
  'services',
]);

if (!allowedActions.has(action)) {
  console.error(
    'usage: node scripts/infra.mjs <config|up|down|restart|ps|logs> [--profile <name>]...',
  );
  process.exit(2);
}

const profiles = [];
for (let index = 3; index < process.argv.length; index += 2) {
  const option = process.argv[index];
  const profile = process.argv[index + 1];
  if (option !== '--profile' || profile === undefined || !allowedProfiles.has(profile)) {
    console.error(
      `infra: expected --profile followed by one of: ${[...allowedProfiles].join(', ')}`,
    );
    process.exit(2);
  }
  if (!profiles.includes(profile)) {
    profiles.push(profile);
  }
}

const envFile = existsSync(join(repositoryRoot, '.env'))
  ? join(repositoryRoot, '.env')
  : join(repositoryRoot, '.env.example');
const composeFile = join(repositoryRoot, 'infra', 'compose.yaml');
const composeBaseArgs = [
  'compose',
  '--env-file',
  envFile,
  '--project-name',
  'wetdrool-local',
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

if (action === 'up') {
  runDocker([...composeArgs(profiles), 'up', '--detach', '--wait', 'postgres', 'redis', 'ipfs']);
  runDocker([...composeArgs([...profiles, 'provision']), 'run', '--rm', 'postgres-provision']);

  if (profiles.includes('privilege-probe')) {
    const probeArgs = composeArgs(['privilege-probe']);
    for (const migrator of [
      'auth-service-migrate',
      'indexer-migrate',
      'moderation-service-migrate',
    ]) {
      runDocker([...probeArgs, 'run', '--rm', '--no-deps', '--build', migrator]);
    }
    runDocker([...probeArgs, 'run', '--rm', '--no-deps', 'postgres-privilege-probe']);
  }
}

runDocker([
  ...composeArgs(
    action === 'up' ? profiles.filter((profile) => profile !== 'privilege-probe') : profiles,
  ),
  ...actionArgs,
]);

function composeArgs(selectedProfiles) {
  return [
    ...composeBaseArgs,
    ...[...new Set(selectedProfiles)].flatMap((profile) => ['--profile', profile]),
  ];
}

function runDocker(arguments_) {
  const result = spawnSync('docker', arguments_, {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`infra: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
