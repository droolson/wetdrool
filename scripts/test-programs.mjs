import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { repositoryRoot } from './workspaces.mjs';
import { chainEnvironment } from './toolchain-paths.mjs';

const environment = chainEnvironment();

if (!existsSync(join(repositoryRoot, 'Anchor.toml'))) {
  console.error('test:programs: Anchor.toml does not exist; no program suite can be verified.');
  process.exit(2);
}

for (const command of ['anchor', 'solana-test-validator']) {
  const probe = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (probe.error || probe.status !== 0) {
    console.error(`test:programs: "${command}" is required but is not available.`);
    process.exit(2);
  }
  console.log(`test:programs: ${probe.stdout.trim()}`);
}

const prepare = spawnSync(process.execPath, ['scripts/prepare-local-solana.mjs'], {
  cwd: repositoryRoot,
  env: environment,
  stdio: 'inherit',
});
if (prepare.error || prepare.status !== 0) {
  console.error(prepare.error?.message ?? 'test:programs: local Solana setup failed.');
  process.exit(prepare.status ?? 1);
}

const result = spawnSync('anchor', ['test'], {
  cwd: repositoryRoot,
  env: environment,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`test:programs: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
