import { spawnSync } from 'node:child_process';

import { readWorkspacePackages } from './workspaces.mjs';

const workspaces = (await readWorkspacePackages()).filter(
  ({ manifest }) => typeof manifest.scripts?.['test:e2e'] === 'string',
);

if (workspaces.length === 0) {
  console.error('test:e2e:install: no workspace package defines a browser test suite.');
  process.exit(2);
}

for (const { directory, manifest } of workspaces) {
  const hasPlaywright =
    typeof manifest.dependencies?.['@playwright/test'] === 'string' ||
    typeof manifest.devDependencies?.['@playwright/test'] === 'string';

  if (!hasPlaywright) {
    console.error(
      `test:e2e:install: ${manifest.name ?? directory} defines test:e2e without @playwright/test.`,
    );
    process.exit(2);
  }

  console.log(`test:e2e:install: installing Chromium for ${manifest.name ?? directory}`);
  const result = spawnSync(
    'pnpm',
    ['--dir', directory, 'exec', 'playwright', 'install', '--with-deps', 'chromium'],
    { stdio: 'inherit' },
  );

  if (result.error || result.status !== 0) {
    console.error(result.error?.message ?? 'test:e2e:install: Playwright installation failed.');
    process.exit(result.status ?? 1);
  }
}
