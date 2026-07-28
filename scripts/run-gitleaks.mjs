import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

import { repositoryRoot } from './workspaces.mjs';

const VERSION = '8.30.1';
const targets = {
  'darwin-arm64': {
    asset: `gitleaks_${VERSION}_darwin_arm64.tar.gz`,
    sha256: 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
  },
  'darwin-x64': {
    asset: `gitleaks_${VERSION}_darwin_x64.tar.gz`,
    sha256: 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
  },
  'linux-arm64': {
    asset: `gitleaks_${VERSION}_linux_arm64.tar.gz`,
    sha256: 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080',
  },
  'linux-x64': {
    asset: `gitleaks_${VERSION}_linux_x64.tar.gz`,
    sha256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
  },
};

const target = targets[`${process.platform}-${process.arch}`];
if (!target) {
  console.error(`gitleaks: unsupported host ${process.platform}-${process.arch}`);
  process.exit(2);
}

const binary = join(repositoryRoot, '.local', 'toolchains', 'gitleaks', VERSION, 'gitleaks');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  });
  if (result.error || result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function fileSha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function ensureBinary() {
  try {
    await access(binary);
    return;
  } catch {
    // Install the checksum-pinned scanner below.
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'socially-woke-gitleaks-'));
  try {
    const archive = join(temporaryDirectory, target.asset);
    const response = await fetch(
      `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${target.asset}`,
      { redirect: 'follow' },
    );
    if (!response.ok || !response.body) {
      throw new Error(`gitleaks download failed with status ${response.status}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { mode: 0o600 }));
    const actual = await fileSha256(archive);
    if (actual !== target.sha256) {
      throw new Error(`gitleaks checksum mismatch: expected ${target.sha256}, received ${actual}`);
    }

    const installation = join(temporaryDirectory, 'installation');
    await mkdir(installation, { recursive: true });
    run('tar', ['-xzf', archive, '-C', installation]);
    await mkdir(dirname(binary), { recursive: true });
    await rename(join(installation, 'gitleaks'), binary);
    await chmod(binary, 0o700);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await ensureBinary();
run(binary, ['dir', '.', '--redact', '--no-banner', '--verbose']);

const hasCommit =
  spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: repositoryRoot,
    stdio: 'ignore',
  }).status === 0;
if (hasCommit) {
  run(binary, ['git', '--redact', '--no-banner', '--verbose']);
}
