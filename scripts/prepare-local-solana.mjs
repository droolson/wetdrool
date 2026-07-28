import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { web3 } from '@coral-xyz/anchor';

import { repositoryRoot } from './workspaces.mjs';

const programKeypair = web3.Keypair.fromSeed(
  Uint8Array.from({ length: 32 }, (_, index) => (index * 17 + 23) % 256),
);
const deployerKeypair = web3.Keypair.fromSeed(
  Uint8Array.from({ length: 32 }, (_, index) => (index * 29 + 11) % 256),
);
const expectedProgramId = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
if (programKeypair.publicKey.toBase58() !== expectedProgramId) {
  throw new Error('deterministic local program keypair no longer matches the declared program ID');
}

async function ensureKeypair(path, keypair) {
  try {
    const current = Uint8Array.from(JSON.parse(await readFile(path, 'utf8')));
    if (web3.Keypair.fromSecretKey(current).publicKey.equals(keypair.publicKey)) {
      return;
    }
  } catch {
    // Create or replace only the generated local-development artifact.
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify([...keypair.secretKey])}\n`, { mode: 0o600 });
}

await ensureKeypair(
  join(repositoryRoot, 'target', 'deploy', 'social_protocol-keypair.json'),
  programKeypair,
);
await ensureKeypair(join(repositoryRoot, '.local', 'solana', 'deployer.json'), deployerKeypair);

console.log(`local-solana: program ${programKeypair.publicKey.toBase58()}`);
console.log(`local-solana: deployer ${deployerKeypair.publicKey.toBase58()}`);
