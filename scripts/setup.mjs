import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';

import { assertSafeLocalDevelopmentEnvironment } from './local-dev-plan.mjs';
import { readWorkspacePackages, repositoryRoot } from './workspaces.mjs';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`setup: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(process.execPath, ['scripts/preflight.mjs', '--with-docker']);
run(process.execPath, ['scripts/install-chain-toolchain.mjs']);

if (!existsSync(join(repositoryRoot, 'node_modules', '.modules.yaml'))) {
  console.error(
    'setup: dependencies are not installed; run "pnpm install --frozen-lockfile" first.',
  );
  process.exit(1);
}

const environmentFile = existsSync(join(repositoryRoot, '.env'))
  ? join(repositoryRoot, '.env')
  : join(repositoryRoot, '.env.example');
loadEnvFile(environmentFile);
assertSafeLocalDevelopmentEnvironment(process.env);

run(process.execPath, ['scripts/infra.mjs', 'up']);
run('pnpm', ['--filter', '@wokesocial/config', 'env:check']);

let executedSteps = 0;
for (const { directory, manifest } of await readWorkspacePackages()) {
  const scripts = manifest.scripts ?? {};
  const steps =
    typeof scripts['setup:local'] === 'string'
      ? ['setup:local']
      : ['migrate', 'seed'].filter((script) => typeof scripts[script] === 'string');

  for (const step of steps) {
    console.log(`setup: running ${step} in ${manifest.name ?? directory}`);
    const result = spawnSync('pnpm', ['--dir', directory, 'run', step], {
      stdio: 'inherit',
    });
    if (result.error || result.status !== 0) {
      console.error(result.error?.message ?? `setup: ${manifest.name} ${step} failed.`);
      process.exit(result.status ?? 1);
    }
    executedSteps += 1;
  }
}

console.log(
  `setup: local infrastructure and environment validation completed; ${executedSteps} workspace initialization step(s) ran.`,
);
