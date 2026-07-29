import { randomBytes } from 'node:crypto';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const probePath = resolve(import.meta.dirname, 'fixtures/postgres-tls-probe.ts');
const containerName = `codex-wokenet-postgres-tls-${process.pid}-${randomBytes(4).toString('hex')}`;
const databasePassword = randomBytes(24).toString('base64url');
const postgresImage = 'postgres:18.4-bookworm';

let certificateDirectory = '';
let trustedCertificate = '';
let mismatchCertificate = '';
let port = 0;
let containerStarted = false;

describe.sequential(
  'verified PostgreSQL TLS transport',
  () => {
    beforeAll(async () => {
      certificateDirectory = await mkdtemp(join(tmpdir(), 'wokenet-postgres-tls-'));
      trustedCertificate = join(certificateDirectory, 'server.crt');
      mismatchCertificate = join(certificateDirectory, 'mismatch.crt');
      generateCertificate('localhost', 'server');
      generateCertificate('wrong-host.invalid', 'mismatch');

      runDocker([
        'run',
        '-d',
        '--name',
        containerName,
        '-e',
        'POSTGRES_USER=wokesocial',
        '-e',
        `POSTGRES_PASSWORD=${databasePassword}`,
        '-e',
        'POSTGRES_DB=wokesocial',
        '-p',
        '127.0.0.1::5432',
        postgresImage,
      ]);
      containerStarted = true;
      await waitForPostgresEntrypointInitialization();
      await waitForPostgres();
      copyCertificatePair('server');
      configureServerCertificate('server');
      runDocker(['restart', containerName]);
      await waitForPostgres();
      port = readPublishedPort();
      await waitForPublishedPort();
    }, 120_000);

    afterAll(async () => {
      if (containerStarted) {
        spawnSync('docker', ['rm', '-f', containerName], {
          cwd: repositoryRoot,
          encoding: 'utf8',
          timeout: 30_000,
        });
      }
      if (certificateDirectory !== '') {
        await rm(certificateDirectory, { force: true, recursive: true });
      }
    });

    it('connects with a mounted trusted CA and proves the session uses TLS', () => {
      const result = runProbe('query', databaseUrl('localhost'), trustedCertificate);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        mode: 'query',
        ok: true,
        ssl: true,
      });
    });

    it('rejects an otherwise valid server when its CA is not trusted', () => {
      const result = runProbe('query', databaseUrl('localhost'));
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
      });
    });

    it('runs every one-shot migrator over verified TLS', () => {
      const result = runProbe('migrate', databaseUrl('localhost'), trustedCertificate, 120_000);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        mode: 'migrate',
        ok: true,
        ssl: true,
      });
    });

    it('rejects a trusted certificate whose DNS identity does not match', async () => {
      copyCertificatePair('mismatch');
      configureServerCertificate('mismatch');
      runDocker([
        'exec',
        containerName,
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'wokesocial',
        '-d',
        'wokesocial',
        '-c',
        'SELECT pg_reload_conf()',
      ]);

      const result = runProbe('query', databaseUrl('localhost'), mismatchCertificate);
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        code: 'ERR_TLS_CERT_ALTNAME_INVALID',
      });
    }, 60_000);
  },
  180_000,
);

function generateCertificate(commonName: string, basename: string): void {
  run(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(certificateDirectory, `${basename}.key`),
      '-out',
      join(certificateDirectory, `${basename}.crt`),
      '-days',
      '1',
      '-subj',
      `/CN=${commonName}`,
      '-addext',
      `subjectAltName=DNS:${commonName}`,
    ],
    30_000,
  );
}

function copyCertificatePair(basename: string): void {
  for (const extension of ['crt', 'key']) {
    runDocker([
      'cp',
      join(certificateDirectory, `${basename}.${extension}`),
      `${containerName}:/var/lib/postgresql/${basename}.${extension}`,
    ]);
  }
  runDocker([
    'exec',
    '-u',
    'root',
    containerName,
    'chown',
    'postgres:postgres',
    `/var/lib/postgresql/${basename}.crt`,
    `/var/lib/postgresql/${basename}.key`,
  ]);
  runDocker([
    'exec',
    '-u',
    'root',
    containerName,
    'chmod',
    '600',
    `/var/lib/postgresql/${basename}.key`,
  ]);
}

function configureServerCertificate(basename: string): void {
  runDocker([
    'exec',
    containerName,
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'wokesocial',
    '-d',
    'wokesocial',
    '-c',
    "ALTER SYSTEM SET ssl = 'on'",
    '-c',
    `ALTER SYSTEM SET ssl_cert_file = '/var/lib/postgresql/${basename}.crt'`,
    '-c',
    `ALTER SYSTEM SET ssl_key_file = '/var/lib/postgresql/${basename}.key'`,
  ]);
}

async function waitForPostgresEntrypointInitialization(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const logs = spawnSync('docker', ['logs', containerName], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 10_000,
    });
    const output = `${logs.stderr}${logs.stdout}`;
    if (
      logs.status === 0 &&
      output.includes('PostgreSQL init process complete; ready for start up.')
    ) {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error('Disposable PostgreSQL entrypoint initialization did not complete.');
}

async function waitForPostgres(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync(
      'docker',
      ['exec', containerName, 'pg_isready', '-U', 'wokesocial', '-d', 'wokesocial'],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        timeout: 5_000,
      },
    );
    if (result.status === 0) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  const logs = spawnSync('docker', ['logs', containerName], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 10_000,
  });
  throw new Error(`Disposable PostgreSQL did not become ready: ${logs.stderr}${logs.stdout}`);
}

async function waitForPublishedPort(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const connected = await new Promise<boolean>((resolveConnection) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      const finish = (result: boolean) => {
        socket.destroy();
        resolveConnection(result);
      };
      socket.setTimeout(1_000, () => finish(false));
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    });
    if (connected) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('Disposable PostgreSQL did not accept host TCP connections.');
}

function readPublishedPort(): number {
  const result = runDocker(['port', containerName, '5432/tcp']);
  const match = /:(?<port>[0-9]+)\s*$/u.exec(result.stdout);
  if (match?.groups?.port === undefined) {
    throw new Error('Could not determine the disposable PostgreSQL port.');
  }
  return Number.parseInt(match.groups.port, 10);
}

function databaseUrl(hostname: string): string {
  const url = new URL('postgresql://wokesocial@localhost/wokesocial');
  url.password = databasePassword;
  url.hostname = hostname;
  url.port = String(port);
  url.searchParams.set('sslmode', 'verify-full');
  return url.href;
}

function runProbe(
  mode: 'query' | 'migrate',
  url: string,
  extraCaCertificate?: string,
  timeout = 30_000,
): SpawnSyncReturns<string> {
  const environment = { ...process.env };
  delete environment.NODE_EXTRA_CA_CERTS;
  return spawnSync('pnpm', ['exec', 'tsx', probePath, mode, url], {
    cwd: resolve(repositoryRoot, 'packages/config'),
    encoding: 'utf8',
    env: {
      ...environment,
      ...(extraCaCertificate === undefined ? {} : { NODE_EXTRA_CA_CERTS: extraCaCertificate }),
    },
    timeout,
  });
}

function runDocker(arguments_: readonly string[]): SpawnSyncReturns<string> {
  return run('docker', arguments_, 120_000);
}

function run(
  command: string,
  arguments_: readonly string[],
  timeout: number,
): SpawnSyncReturns<string> {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${String(result.status)}): ${result.stderr}${result.stdout}`,
    );
  }
  return result;
}
