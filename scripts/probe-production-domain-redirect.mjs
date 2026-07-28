import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access } from 'node:fs/promises';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(repositoryRoot, 'apps/web');
const requireFromWeb = createRequire(resolve(webRoot, 'package.json'));
const nextCli = requireFromWeb.resolve('next/dist/bin/next');
const buildId = resolve(webRoot, '.next/BUILD_ID');

await access(buildId).catch(() => {
  throw new Error(
    'The production web build is missing. Run `pnpm --filter @wokesocial/web build`.',
  );
});

const port = await availablePort();
const output = [];
const server = spawn(
  process.execPath,
  [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
  {
    cwd: webRoot,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', (chunk) => {
    output.push(String(chunk));
    if (output.join('').length > 16_000) output.shift();
  });
}

try {
  await waitUntilReady(server, port, output);

  await expectRedirect(
    port,
    'sociallywoke.com',
    '/people/%E2%9C%93?tab=following&empty=',
    'https://woke.social/people/%E2%9C%93?tab=following&empty=',
  );
  await expectRedirect(
    port,
    'www.sociallywoke.com:443',
    '/settings?section=privacy',
    'https://woke.social/settings?section=privacy',
  );
  await expectPassThrough(port, 'woke.social');
  await expectPassThrough(port, 'sociallywoke.com.example');
  await expectPassThrough(port, 'sociallywoke.com.');

  process.stdout.write(
    'Production domain probe passed: exact legacy hosts redirect permanently to woke.social.\n',
  );
} finally {
  await stopServer(server);
}

async function availablePort() {
  const reservation = createServer();
  reservation.unref();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  if (address === null || typeof address === 'string') {
    reservation.close();
    throw new Error('Could not reserve an IPv4 loopback port.');
  }
  const selectedPort = address.port;
  const closed = once(reservation, 'close');
  reservation.close();
  await closed;
  return selectedPort;
}

async function waitUntilReady(child, portNumber, capturedOutput) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `Production web server exited with ${String(child.exitCode)}.\n${capturedOutput.join('')}`,
      );
    }
    try {
      const response = await httpRequest(portNumber, 'woke.social', '/');
      if (response.statusCode === 200) return;
    } catch {
      // The listener is not ready yet.
    }
    await delay(100);
  }
  throw new Error(`Production web server did not become ready.\n${capturedOutput.join('')}`);
}

async function expectRedirect(portNumber, host, path, expectedLocation) {
  const response = await httpRequest(portNumber, host, path);
  if (response.statusCode !== 308 || response.location !== expectedLocation) {
    throw new Error(
      `Expected ${host}${path} to return 308 ${expectedLocation}; received ${String(
        response.statusCode,
      )} ${String(response.location)}.`,
    );
  }
}

async function expectPassThrough(portNumber, host) {
  const response = await httpRequest(portNumber, host, '/');
  if (response.statusCode !== 200 || response.location !== undefined) {
    throw new Error(
      `Expected ${host} to pass through with 200 and no Location header; received ${String(
        response.statusCode,
      )} ${String(response.location)}.`,
    );
  }
}

function httpRequest(portNumber, host, path) {
  return new Promise((resolveRequest, rejectRequest) => {
    const outbound = request(
      {
        host: '127.0.0.1',
        port: portNumber,
        path,
        method: 'GET',
        headers: {
          Host: host,
        },
      },
      (response) => {
        response.resume();
        response.once('end', () => {
          resolveRequest({
            statusCode: response.statusCode,
            location: response.headers.location,
          });
        });
      },
    );
    outbound.setTimeout(5_000, () => {
      outbound.destroy(new Error('Production domain probe request timed out.'));
    });
    outbound.once('error', rejectRequest);
    outbound.end();
  });
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}
