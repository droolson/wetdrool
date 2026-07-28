import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const legacyDomain = `sociallywoke${'.com'}`;
const ignoredDirectories = new Set([
  '.git',
  '.local',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'target',
  'test-results',
]);
const intentionalLegacyReferences = new Set([
  '.env.example',
  'README.md',
  'apps/auth-service/README.md',
  'apps/auth-service/src/config.ts',
  'apps/auth-service/test/security.test.ts',
  'apps/feed-service/src/config.ts',
  'apps/feed-service/test/app.test.ts',
  'apps/media-worker/src/config.ts',
  'apps/media-worker/test/config-subprocess.test.ts',
  'apps/moderation-service/src/config.ts',
  'apps/moderation-service/test/config.test.ts',
  'apps/relay/src/config.ts',
  'apps/relay/test/state.test.ts',
  'apps/web/lib/canonical-host.ts',
  'apps/web/lib/auth/auth-api.ts',
  'apps/web/lib/provider-config.ts',
  'apps/web/tests/browser-auth-client.test.ts',
  'apps/web/tests/canonical-host.test.ts',
  'apps/web/tests/provider-config.test.ts',
  'docs/DECENTRALIZATION.md',
  'docs/DECISIONS/0008-canonical-domain-transition.md',
  'docs/DEPLOYMENT.md',
  'docs/MODERATION.md',
  'docs/OPERATIONS.md',
  'docs/PRIVACY.md',
  'docs/PRODUCT_SPEC.md',
  'docs/PROTOCOL.md',
  'docs/ROADMAP.md',
  'docs/TESTING.md',
  'packages/config/src/env.ts',
  'packages/config/test/env.test.ts',
  'scripts/probe-production-domain-redirect.mjs',
]);
const requiredCanonicalMarkers = new Map([
  ['apps/web/lib/canonical-host.ts', "CANONICAL_ORIGIN = 'https://woke.social'"],
  ['apps/web/proxy.ts', "request.headers.get('host')"],
  [
    'apps/web/lib/provider-config.ts',
    'legacy redirect-only hostname cannot be a provider endpoint',
  ],
  ['apps/feed-service/src/config.ts', 'cannot use the legacy redirect host'],
  ['apps/media-worker/src/config.ts', 'cannot use the legacy redirect host'],
  ['apps/relay/src/config.ts', 'cannot use the legacy redirect host'],
  ['packages/config/src/env.ts', 'must not use a legacy redirect-only hostname'],
  ['packages/protocol/src/constants.ts', "SIGNATURE_DOMAIN = 'woke.social/protocol/signed-object'"],
  ['apps/relay/src/protocol.ts', 'woke.social/relay/signed-envelope'],
  [
    'scripts/probe-production-domain-redirect.mjs',
    'Production domain probe passed: exact legacy hosts redirect permanently to woke.social.',
  ],
]);

const violations = [];
for (const path of await workspaceFiles(repositoryRoot)) {
  const workspacePath = relative(repositoryRoot, path);
  const metadata = await stat(path);
  if (metadata.size > 1_000_000) continue;
  const bytes = await readFile(path);
  if (bytes.includes(0)) continue;
  if (
    bytes.toString('utf8').includes(legacyDomain) &&
    !intentionalLegacyReferences.has(workspacePath)
  ) {
    violations.push(workspacePath);
  }
}

for (const [workspacePath, marker] of requiredCanonicalMarkers) {
  const contents = await readFile(resolve(repositoryRoot, workspacePath), 'utf8');
  if (!contents.includes(marker)) {
    violations.push(`${workspacePath} (missing canonical marker)`);
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `Legacy or missing canonical domain references:\n${violations
      .sort()
      .map((path) => `- ${path}`)
      .join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write('Canonical domain policy is consistent: woke.social is primary.\n');
}

async function workspaceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...(await workspaceFiles(resolve(directory, entry.name))));
      }
    } else if (entry.isFile()) {
      files.push(resolve(directory, entry.name));
    }
  }
  return files;
}
