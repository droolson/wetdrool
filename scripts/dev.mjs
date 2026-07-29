import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';

import {
  assertSafeLocalDevelopmentEnvironment,
  LOCAL_DEV_CONTAINER_PROFILES,
  LOCAL_DEV_ENVIRONMENT_OVERRIDES,
  LOCAL_DEV_EXCLUDED_PACKAGES,
  localDevTurboArguments,
  removeLocalSetupDatabaseSecrets,
  selectLocalEnvironmentFile,
} from './local-dev-plan.mjs';
import { readWorkspacePackages, repositoryRoot } from './workspaces.mjs';

const checkOnly = process.argv[2] === '--check';
if (process.argv.length > (checkOnly ? 3 : 2)) {
  console.error('usage: node scripts/dev.mjs [--check]');
  process.exit(2);
}

if (!existsSync(join(repositoryRoot, 'node_modules', '.modules.yaml'))) {
  console.error('dev: dependencies are not installed; run "pnpm install --frozen-lockfile" first.');
  process.exit(1);
}

const environmentFile = selectLocalEnvironmentFile(repositoryRoot);
loadEnvFile(environmentFile);

try {
  assertSafeLocalDevelopmentEnvironment(process.env);
} catch (error) {
  console.error(`dev: ${error instanceof Error ? error.message : 'invalid local environment'}`);
  process.exit(1);
}

Object.assign(process.env, LOCAL_DEV_ENVIRONMENT_OVERRIDES);

if (checkOnly) {
  console.log(
    JSON.stringify(
      {
        environmentFile,
        containerProfiles: LOCAL_DEV_CONTAINER_PROFILES,
        localEnvironmentOverrides: Object.keys(LOCAL_DEV_ENVIRONMENT_OVERRIDES),
        runtimeSecretPolicy:
          'remove bootstrap/migration/raw-password variables, then scope each runtime to at most its own database URL',
        excludedLocalProcesses: LOCAL_DEV_EXCLUDED_PACKAGES,
        turboArguments: localDevTurboArguments(),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

run(process.execPath, ['scripts/preflight.mjs', '--with-docker']);
run(process.execPath, [
  'scripts/infra.mjs',
  'up',
  ...LOCAL_DEV_CONTAINER_PROFILES.flatMap((profile) => ['--profile', profile]),
]);
run('pnpm', ['--filter', '@wokesocial/config', 'env:check']);

for (const { directory, manifest } of await readWorkspacePackages()) {
  if (typeof manifest.scripts?.['setup:local'] !== 'string') {
    continue;
  }
  console.log(`dev: running setup:local in ${manifest.name ?? directory}`);
  run('pnpm', ['--dir', directory, 'run', 'setup:local']);
}

removeLocalSetupDatabaseSecrets(process.env);

console.log(
  'dev: base infrastructure and the private media stack are healthy; starting local workspace processes.',
);
run('pnpm', localDevTurboArguments());

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`dev: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
