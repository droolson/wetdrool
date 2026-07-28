import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const maximumGenesisBytes = 128 * 1024 * 1024;

function encodeBase58(bytes) {
  if (bytes.length === 0) return '';
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) {
    leadingZeroes += 1;
  }
  let encoded = '';
  while (value > 0n) {
    const digit = Number(value % 58n);
    encoded = `${BASE58_ALPHABET[digit]}${encoded}`;
    value /= 58n;
  }
  return `${'1'.repeat(leadingZeroes)}${encoded}`;
}

const rawArguments = process.argv.slice(2);
const arguments_ = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments;
const [pathArgument, expectedHash] = arguments_;
if (pathArgument === undefined || expectedHash === undefined || arguments_.length !== 2) {
  console.error('usage: node scripts/verify-woke-genesis.mjs <genesis.bin> <expected-base58-hash>');
  process.exit(2);
}

const genesisPath = resolve(pathArgument);
const handle = await open(genesisPath, constants.O_RDONLY | constants.O_NOFOLLOW);
const hash = createHash('sha256');
const buffer = Buffer.allocUnsafe(1024 * 1024);
let bytesRead = 0;
try {
  const metadata = await handle.stat();
  if (!metadata.isFile() || metadata.size < 32 || metadata.size > maximumGenesisBytes) {
    console.error(`woke-genesis: unexpected genesis size ${metadata.size} bytes`);
    process.exitCode = 1;
  } else {
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
      if (bytesRead > maximumGenesisBytes) {
        console.error(`woke-genesis: genesis exceeded ${maximumGenesisBytes} bytes while reading`);
        process.exitCode = 1;
        break;
      }
      hash.update(buffer.subarray(0, result.bytesRead));
    }
  }
} finally {
  await handle.close();
}
if (process.exitCode !== undefined) process.exit(process.exitCode);
if (bytesRead < 32) {
  console.error(`woke-genesis: unexpected genesis size ${bytesRead} bytes`);
  process.exit(1);
}

const digest = hash.digest();
const genesisHash = encodeBase58(digest);
if (expectedHash !== genesisHash) {
  console.error(`woke-genesis: expected ${expectedHash}, received ${genesisHash}`);
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      verification: 'sha256-base58-hash-match-only',
      semanticGenesisValidation: false,
      path: genesisPath,
      bytes: bytesRead,
      sha256Hex: digest.toString('hex'),
      genesisHash,
      canonicalNetworkIdTemplate: `woke:v1:${genesisHash}:<program-id>`,
    },
    null,
    2,
  )}\n`,
);
