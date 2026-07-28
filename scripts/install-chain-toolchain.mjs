import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

import {
  agaveRoot,
  anchorRoot,
  cargoHome,
  chainEnvironment,
  rustupHome,
  toolchainRoot,
} from './toolchain-paths.mjs';

const AGAVE_VERSION = '2.3.0';
const ANCHOR_VERSION = '0.32.1';
const RUST_VERSION = '1.89.0';

const supportedTargets = {
  'darwin-arm64': {
    agaveAsset: 'solana-release-aarch64-apple-darwin.tar.bz2',
    agaveSha256: 'dad301dc7b77a93093efc921c602b05397ec8f8c35195940417b3dcc28124d74',
    anchorAsset: 'anchor-0.32.1-aarch64-apple-darwin',
    anchorSha256: '10c63cc7af8aaa3e0dde9c4bfad17c6a47797e7685d5f25236b14d6d5642a02a',
    rustupTarget: 'aarch64-apple-darwin',
  },
  'darwin-x64': {
    agaveAsset: 'solana-release-x86_64-apple-darwin.tar.bz2',
    agaveSha256: '646e8e0b70f2b4f985f763b353bd73567b476f371ed26aad680a0491d3695a11',
    anchorAsset: 'anchor-0.32.1-x86_64-apple-darwin',
    anchorSha256: 'beec62b617ab8afce6776a9234b85ab203959cee25d179e8aab8cec48b468234',
    rustupTarget: 'x86_64-apple-darwin',
  },
  'linux-x64': {
    agaveAsset: 'solana-release-x86_64-unknown-linux-gnu.tar.bz2',
    agaveSha256: '56241fbe862495ff01b2b875195e44f94c22e9f2a504591a3ade1b9d82862730',
    anchorAsset: 'anchor-0.32.1-x86_64-unknown-linux-gnu',
    anchorSha256: '5f25b850ce80278507a98947833fcd48423391f6d145046ffb0c5fd130dec436',
    rustupTarget: 'x86_64-unknown-linux-gnu',
  },
};

const target = supportedTargets[`${process.platform}-${process.arch}`];
if (!target) {
  console.error(
    `toolchain: unsupported host ${process.platform}-${process.arch}; install Rust ${RUST_VERSION}, Agave ${AGAVE_VERSION}, and Anchor ${ANCHOR_VERSION} manually.`,
  );
  process.exit(2);
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { mode: 0o600 }));
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function verify(path, expected) {
  const actual = await sha256(path);
  if (actual !== expected) {
    throw new Error(
      `checksum mismatch for ${basename(path)}: expected ${expected}, received ${actual}`,
    );
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: chainEnvironment(),
    ...options,
  });
  if (result.error || result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || result.error?.message;
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.trim();
}

async function ensureRust(temporaryDirectory) {
  const rustup = join(cargoHome, 'bin', 'rustup');
  try {
    const version = run(rustup, ['run', RUST_VERSION, 'rustc', '--version']);
    if (version.startsWith(`rustc ${RUST_VERSION} `)) {
      console.log(`toolchain: ${version}`);
      return;
    }
  } catch {
    // Install the exact workspace toolchain below.
  }

  await mkdir(cargoHome, { recursive: true });
  await mkdir(rustupHome, { recursive: true });
  const installer = join(temporaryDirectory, 'rustup-init');
  const checksumUrl = `https://static.rust-lang.org/rustup/dist/${target.rustupTarget}/rustup-init.sha256`;
  const checksumResponse = await fetch(checksumUrl);
  if (!checksumResponse.ok) {
    throw new Error(`unable to download Rust installer checksum (${checksumResponse.status})`);
  }
  const expected = (await checksumResponse.text()).match(/[a-f0-9]{64}/u)?.[0];
  if (!expected) {
    throw new Error('Rust installer checksum response was malformed');
  }
  await download(
    `https://static.rust-lang.org/rustup/dist/${target.rustupTarget}/rustup-init`,
    installer,
  );
  await verify(installer, expected);
  await chmod(installer, 0o700);
  run(installer, [
    '-y',
    '--no-modify-path',
    '--profile',
    'minimal',
    '--default-toolchain',
    RUST_VERSION,
  ]);
  run(rustup, [
    'toolchain',
    'install',
    RUST_VERSION,
    '--profile',
    'minimal',
    '--component',
    'clippy',
    '--component',
    'rustfmt',
  ]);
  console.log(`toolchain: ${run(rustup, ['run', RUST_VERSION, 'rustc', '--version'])}`);
}

async function ensureAgave(temporaryDirectory) {
  const solana = join(agaveRoot, 'bin', 'solana');
  try {
    const version = run(solana, ['--version']);
    if (version.includes(` ${AGAVE_VERSION} `)) {
      console.log(`toolchain: ${version}`);
      return;
    }
  } catch {
    // Restore the pinned release below.
  }

  const archive = join(temporaryDirectory, target.agaveAsset);
  await download(
    `https://github.com/anza-xyz/agave/releases/download/v${AGAVE_VERSION}/${target.agaveAsset}`,
    archive,
  );
  await verify(archive, target.agaveSha256);
  const versionRoot = join(toolchainRoot, 'agave', AGAVE_VERSION);
  const stagedRoot = join(temporaryDirectory, 'agave');
  await mkdir(stagedRoot, { recursive: true });
  run('tar', ['-xjf', archive, '-C', stagedRoot], { env: process.env });
  await rm(versionRoot, { recursive: true, force: true });
  await mkdir(dirname(versionRoot), { recursive: true });
  await rename(stagedRoot, versionRoot);
  console.log(`toolchain: ${run(solana, ['--version'])}`);
}

async function ensureAnchor(temporaryDirectory) {
  const anchor = join(anchorRoot, 'bin', 'anchor');
  try {
    const version = run(anchor, ['--version']);
    if (version.includes(ANCHOR_VERSION)) {
      console.log(`toolchain: ${version}`);
      return;
    }
  } catch {
    // Restore the pinned release below.
  }

  const binary = join(temporaryDirectory, target.anchorAsset);
  await download(
    `https://github.com/otter-sec/anchor/releases/download/v${ANCHOR_VERSION}/${target.anchorAsset}`,
    binary,
  );
  await verify(binary, target.anchorSha256);
  await mkdir(join(anchorRoot, 'bin'), { recursive: true });
  const stagedBinary = join(anchorRoot, 'bin', '.anchor-installing');
  await writeFile(stagedBinary, await readFile(binary), { mode: 0o700 });
  await rename(stagedBinary, anchor);
  console.log(`toolchain: ${run(anchor, ['--version'])}`);
}

await mkdir(toolchainRoot, { recursive: true });
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'socially-woke-toolchain-'));
try {
  await ensureRust(temporaryDirectory);
  await ensureAgave(temporaryDirectory);
  await ensureAnchor(temporaryDirectory);
  console.log('toolchain: pinned Rust, Agave, and Anchor installations are ready.');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
