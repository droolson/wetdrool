import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ClamdScanner } from '../dist/src/clamd-scanner.js';

const host = process.env['MEDIA_WORKER_CLAMD_HOST'];
const port = Number(process.env['MEDIA_WORKER_CLAMD_PORT'] ?? '3310');
const streamMaximumBytes = Number(
  process.env['MEDIA_WORKER_CLAMD_STREAM_MAX_BYTES'] ?? '100000000',
);

if (host === undefined) {
  throw new Error('MEDIA_WORKER_CLAMD_HOST is required.');
}

const scanner = new ClamdScanner({
  host,
  port,
  streamMaximumBytes,
  connectTimeoutMilliseconds: 5_000,
  scanTimeoutMilliseconds: 30_000,
});

if (!(await scanner.healthCheck())) {
  throw new Error('Clamd PING verification failed.');
}

const root = await mkdtemp(join(tmpdir(), 'wokesocial-clamd-verification-'));
try {
  const benign = Buffer.from('WokeSocial benign ClamAV integration fixture.\n', 'utf8');
  const eicar = Buffer.from(
    ['X5O!P%@AP[4', '\\PZX54(P^)7CC)7}$EICAR', '-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''),
    'ascii',
  );
  const benignResult = await scanFixture('benign.txt', benign);
  const eicarResult = await scanFixture('eicar.txt', eicar);

  if (benignResult.status !== 'passed') {
    throw new Error('Clamd rejected the benign verification fixture.');
  }
  if (
    !/^adapter=1;engine=[0-9.]+;db=[0-9]+;dbAt=[0-9T:.+-]+Z$/u.test(benignResult.scannerVersion)
  ) {
    throw new Error('Clamd did not return bounded engine/database provenance.');
  }
  if (
    eicarResult.status !== 'failed' ||
    eicarResult.detail !== 'Malware was detected.' ||
    JSON.stringify(eicarResult).includes('Eicar-Test-Signature') ||
    !/^adapter=1;engine=[0-9.]+;db=[0-9]+;dbAt=[0-9T:.+-]+Z$/u.test(eicarResult.scannerVersion)
  ) {
    throw new Error('Clamd did not return generic malware-detection evidence.');
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      scanner: scanner.name,
      benign: benignResult.status,
      malware: eicarResult.status,
    })}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

async function scanFixture(filename, bytes) {
  const path = join(root, filename);
  await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
  return scanner.scan({
    path,
    mediaType: 'application/octet-stream',
    sha256: `u${createHash('sha256').update(bytes).digest('base64url')}`,
    byteLength: bytes.byteLength,
    signal: new AbortController().signal,
  });
}
