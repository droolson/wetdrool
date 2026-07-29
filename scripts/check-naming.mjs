import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const formerPlatformParts = ['socially', 'woke'];
const formerPlatformCompact = formerPlatformParts.join('');
const formerPlatformDisplayParts = ['Woke', 'Social'];
const approvedPlatformLegalEntity = `${formerPlatformDisplayParts.join(' ')}, Inc.`;
const legacyHost = `${formerPlatformCompact}.com`;
const computedLegacyHostToken = formerPlatformCompact + '${' + "'.com'" + '}';
const legacyHostPattern = new RegExp(
  `(?:www(?:\\\\)?\\.)?${formerPlatformCompact}(?:\\\\)?\\.com`,
  'giu',
);
const formerChainParts = ['woke', 'network'];
const formerChainDisplay = ['W', 'o', 'k', 'e'].join('');
const formerPlatformShorthand = ['s', 'w'].join('');
const formerObjectIdPrefix = formerPlatformShorthand + ['o', 'b', 'j'].join('');
const formerBlobIdPrefix = formerPlatformShorthand + ['b', 'l', 'o', 'b'].join('');
const formerMessageIdPrefix = formerPlatformShorthand + ['m'].join('');
const formerPdaBytes = ['0x73', '0x77'].join('\\s*,\\s*');

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

const forbiddenContent = [
  {
    label: 'former platform name or namespace',
    pattern: new RegExp(formerPlatformParts.join('[ _-]?'), 'iu'),
  },
  {
    label: 'former inverted platform display name',
    pattern: new RegExp(formerPlatformDisplayParts.join('[ _-]+'), 'u'),
  },
  {
    label: 'former platform shorthand identifier',
    pattern: new RegExp(
      `(?:(?:--|@|__Host-|did:|\\b)${formerPlatformShorthand}(?:[-_:]|id\\b)|['"]${formerPlatformShorthand}['"])`,
      'iu',
    ),
  },
  {
    label: 'former protocol shorthand identifier',
    pattern: new RegExp(
      `(?:\\b(?:${formerObjectIdPrefix}|${formerBlobIdPrefix}):v\\d+\\b|\\b${formerMessageIdPrefix}_[A-Za-z0-9_-]{22}\\b)`,
      'iu',
    ),
  },
  {
    label: 'former encoded platform PDA prefix',
    pattern: new RegExp(
      `\\bPDA_PREFIX\\s*=\\s*Uint8Array\\.of\\(\\s*${formerPdaBytes}\\s*\\)`,
      'u',
    ),
  },
  {
    label: 'former chain name or slug',
    pattern: new RegExp(formerChainParts.join('[ _-]?'), 'iu'),
  },
  {
    label: 'former chain network identifier',
    pattern: new RegExp(`${formerChainParts[0]}:v\\d+`, 'u'),
  },
  {
    label: 'former standalone chain display name',
    pattern: new RegExp(
      `\\b(?:native\\s+${formerChainDisplay}|${formerChainDisplay}\\s+(?:binary|cluster|devnet|execution|localnet|mainnet|RPC|static|testnet|validator))\\b`,
      'u',
    ),
  },
  {
    label: 'former chain command namespace',
    pattern: new RegExp(`network:${formerChainParts[0]}`, 'u'),
  },
  {
    label: 'former chain environment namespace',
    pattern:
      /\b(?:NEXT_PUBLIC_)?WOKE_(?:COMMITMENT|NETWORK|RPC(?:_URLS?)?|SYSTEM_PROGRAM_ADDRESS|UPGRADEABLE_LOADER_ADDRESS|WS_URLS)\b/u,
  },
  {
    label: 'former chain artifact slug',
    pattern: /\bwoke[-_](?:attestation|firedancer|genesis|local|network|rpc|source|validator)\b/iu,
  },
];

const violations = [];
const repositoryDirectory = basename(repositoryRoot);
const canonicalLocalDirectory = repositoryDirectory === 'wokenet';
const canonicalGithubCheckout =
  repositoryDirectory === 'wokesocial' &&
  process.env['GITHUB_ACTIONS'] === 'true' &&
  process.env['GITHUB_REPOSITORY'] === 'wokesocial/wokesocial' &&
  resolve(process.env['GITHUB_WORKSPACE'] ?? '') === repositoryRoot;
if (!canonicalLocalDirectory && !canonicalGithubCheckout) {
  violations.push({
    path: '.',
    label: `local repository directory must be named wokenet, found ${repositoryDirectory}`,
  });
}

for (const path of await workspaceFiles(repositoryRoot)) {
  const workspacePath = relative(repositoryRoot, path);
  const normalizedPath = workspacePath.replaceAll('\\', '/');
  const pathWithoutLegacyHost = stripLegacyHost(normalizedPath);
  for (const rule of forbiddenContent) {
    if (rule.pattern.test(pathWithoutLegacyHost)) {
      violations.push({ path: workspacePath, label: `${rule.label} in path` });
    }
  }

  const metadata = await stat(path);
  if (metadata.size > 1_000_000) continue;
  const bytes = await readFile(path);
  if (bytes.includes(0)) continue;
  const contents = stripApprovedLegalEntity(stripLegacyHost(bytes.toString('utf8')));
  for (const rule of forbiddenContent) {
    if (rule.pattern.test(contents)) {
      violations.push({ path: workspacePath, label: rule.label });
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `Naming migration violations:\n${violations
      .sort((left, right) =>
        `${left.path}:${left.label}`.localeCompare(`${right.path}:${right.label}`),
      )
      .map(({ path, label }) => `- ${path}: ${label}`)
      .join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    'Naming policy is consistent: WokeSocial is the platform; WokeNet is its Solana deployment namespace and repository.\n',
  );
}

function stripLegacyHost(value) {
  return value
    .replace(legacyHostPattern, '')
    .replaceAll(`www.${legacyHost}`, '')
    .replaceAll(legacyHost, '')
    .replaceAll(computedLegacyHostToken, '');
}

function stripApprovedLegalEntity(value) {
  return value.replaceAll(approvedPlatformLegalEntity, '');
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
