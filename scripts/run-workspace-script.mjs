import { spawnSync } from 'node:child_process';

import { readWorkspacePackages } from './workspaces.mjs';

const [, , scriptName, ...flags] = process.argv;
const checkOnly = flags.includes('--check');

if (!scriptName || !/^[a-zA-Z0-9:_-]+$/.test(scriptName)) {
  console.error('usage: node scripts/run-workspace-script.mjs <script> [--check]');
  process.exit(2);
}

const workspaces = (await readWorkspacePackages()).filter(
  ({ manifest }) =>
    manifest.scripts &&
    typeof manifest.scripts === 'object' &&
    typeof manifest.scripts[scriptName] === 'string',
);

if (workspaces.length === 0) {
  console.error(`No workspace package defines the "${scriptName}" script.`);
  process.exit(2);
}

if (checkOnly) {
  console.log(`${workspaces.length} workspace package(s) define "${scriptName}".`);
  process.exit(0);
}

for (const { directory, manifest } of workspaces) {
  console.log(`Running ${scriptName} in ${manifest.name ?? directory}`);
  const result = spawnSync('pnpm', ['--dir', directory, 'run', scriptName], {
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
