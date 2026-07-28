import { writeFile } from 'node:fs/promises';
import { type AddressInfo, createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ClamdScanner } from '../src/clamd-scanner.js';
import { digestBytes } from '../src/digests.js';
import { createTestRoot, fixedNow, removeTestRoot } from './fixtures.js';

const servers: Server[] = [];
const sockets = new Set<Socket>();
const roots: string[] = [];
const versionResponse = Buffer.from('ClamAV 1.5.3/28075/Tue Jul 28 12:00:00 2026\0', 'ascii');
const versionEvidence = 'adapter=1;engine=1.5.3;db=28075;dbAt=2026-07-28T12:00:00.000Z';

afterEach(async () => {
  for (const socket of sockets) {
    socket.destroy();
  }
  sockets.clear();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
  await Promise.all(roots.splice(0).map(removeTestRoot));
});

describe('ClamdScanner INSTREAM adapter', () => {
  it('sends bounded 32-bit big-endian chunks and accepts a clean response', async () => {
    const bytes = Buffer.alloc(5_000, 0x61);
    const observedChunks: Buffer[] = [];
    const { port } = await fakeClamd((socket) => {
      parseInstream(socket, (chunks) => {
        observedChunks.push(...chunks);
        socket.write(Buffer.from('stream: OK\0', 'ascii'));
      });
    });
    const { scanner, input } = await scannerFixture(port, bytes, {
      chunkBytes: 1_024,
    });

    await expect(scanner.scan(input)).resolves.toEqual({
      status: 'passed',
      scanner: 'clamd-instream',
      scannerVersion: versionEvidence,
      checkedAt: fixedNow.toISOString(),
    });
    expect(observedChunks.map((chunk) => chunk.byteLength)).toEqual([
      1_024, 1_024, 1_024, 1_024, 904,
    ]);
    expect(Buffer.concat(observedChunks)).toEqual(bytes);
  });

  it('returns generic failed evidence for FOUND without exposing the signature', async () => {
    const { port } = await fakeClamd((socket) => {
      parseInstream(socket, () => {
        socket.write(Buffer.from('stream: Eicar-Test-Signature FOUND\0', 'ascii'));
      });
    });
    const { scanner, input } = await scannerFixture(port, Buffer.from('not malware'));

    const result = await scanner.scan(input);
    expect(result).toMatchObject({
      status: 'failed',
      scanner: 'clamd-instream',
      detail: 'Malware was detected.',
    });
    expect(JSON.stringify(result)).not.toContain('Eicar-Test-Signature');
  });

  it('parses a response fragmented across arbitrary TCP packets', async () => {
    const { port } = await fakeClamd((socket) => {
      parseInstream(socket, () => {
        socket.write(Buffer.from('str', 'ascii'));
        setImmediate(() => {
          socket.write(Buffer.from('eam: OK', 'ascii'));
          setImmediate(() => socket.write(Buffer.from([0])));
        });
      });
    });
    const { scanner, input } = await scannerFixture(port, Buffer.from('fragmented'));

    await expect(scanner.scan(input)).resolves.toMatchObject({ status: 'passed' });
  });

  it.each([
    ['malformed', Buffer.from('stream: ATTACKER_SECRET ERROR\0', 'ascii')],
    ['trailing bytes', Buffer.from('stream: OK\0ATTACKER_SECRET', 'ascii')],
    ['invalid UTF-8', Buffer.from([0xff, 0])],
  ])('fails closed on a %s response', async (_label, response) => {
    const { port } = await fakeClamd((socket) => {
      parseInstream(socket, () => socket.write(response));
    });
    const { scanner, input } = await scannerFixture(port, Buffer.from('private-file-bytes'));

    try {
      await scanner.scan(input);
      throw new Error('Expected scan to fail.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'scanner-unavailable' });
      expect(error instanceof Error ? error.message : '').not.toContain('ATTACKER_SECRET');
      expect(error instanceof Error ? error.message : '').not.toContain('private-file-bytes');
    }
  });

  it('fails closed on an oversized response', async () => {
    const { port } = await fakeClamd((socket) => {
      parseInstream(socket, () => socket.write(Buffer.alloc(4_097, 0x78)));
    });
    const { scanner, input } = await scannerFixture(port, Buffer.from('oversized'));

    await expect(scanner.scan(input)).rejects.toMatchObject({ code: 'scanner-unavailable' });
  });

  it('enforces its scan timeout and closes a silent daemon connection', async () => {
    let connectionEnded!: Promise<void>;
    const { port } = await fakeClamd((socket) => {
      connectionEnded = new Promise((resolve) => socket.once('end', resolve));
      parseInstream(socket, () => undefined);
    });
    const { scanner, input } = await scannerFixture(port, Buffer.from('timeout'), {
      scanTimeoutMilliseconds: 30,
    });

    await expect(scanner.scan(input)).rejects.toMatchObject({ code: 'scanner-unavailable' });
    await expect(connectionEnded).resolves.toBeUndefined();
  });

  it('propagates caller abort by tearing down the daemon connection', async () => {
    const controller = new AbortController();
    let connectionEnded!: Promise<void>;
    const { port } = await fakeClamd((socket) => {
      connectionEnded = new Promise((resolve) => socket.once('end', resolve));
      socket.once('data', () => controller.abort(new Error('caller cancelled')));
    });
    const { scanner, input } = await scannerFixture(port, Buffer.alloc(64_000, 0x62), {
      signal: controller.signal,
    });

    await expect(scanner.scan(input)).rejects.toMatchObject({ code: 'scanner-unavailable' });
    await expect(connectionEnded).resolves.toBeUndefined();
  });

  it('fails closed when clamd closes before a terminated response', async () => {
    const { port } = await fakeClamd((socket) => {
      socket.once('data', () => socket.destroy());
    });
    const { scanner, input } = await scannerFixture(port, Buffer.from('early-close'));

    await expect(scanner.scan(input)).rejects.toMatchObject({ code: 'scanner-unavailable' });
  });

  it('uses a bounded PING check and rejects public or link-local scanner addresses', async () => {
    const { port } = await fakeClamd((socket) => {
      socket.once('data', (command) => {
        if (command.equals(Buffer.from('zPING\0', 'ascii'))) {
          socket.write(Buffer.from('PONG\0', 'ascii'));
        }
      });
    });
    const scanner = new ClamdScanner({
      host: '127.0.0.1',
      port,
      streamMaximumBytes: 100,
    });
    await expect(scanner.healthCheck()).resolves.toBe(true);

    for (const host of ['8.8.8.8', '169.254.169.254', 'fe80::1', '::ffff:169.254.169.254']) {
      const rejectedScanner = new ClamdScanner({
        host,
        port: 3310,
        streamMaximumBytes: 100,
      });
      await expect(rejectedScanner.healthCheck()).resolves.toBe(false);
    }
  });

  it.each([
    ['stale database', Buffer.from('ClamAV 1.5.3/10000/Fri Jul 24 12:00:00 2026\0', 'ascii')],
    ['malformed version', Buffer.from('ClamAV attacker-controlled-version\0', 'ascii')],
    ['future database', Buffer.from('ClamAV 1.5.3/99999/Wed Jul 29 12:00:00 2026\0', 'ascii')],
  ])('fails readiness for a %s response', async (_label, response) => {
    const { port } = await fakeClamd(
      (socket) => {
        socket.once('data', (command) => {
          if (command.equals(Buffer.from('zPING\0', 'ascii'))) {
            socket.write(Buffer.from('PONG\0', 'ascii'));
          }
        });
      },
      { versionResponse: response },
    );
    const scanner = new ClamdScanner({
      host: '127.0.0.1',
      port,
      streamMaximumBytes: 100,
      maximumDatabaseAgeMilliseconds: 24 * 60 * 60 * 1_000,
      clock: () => fixedNow,
    });

    await expect(scanner.healthCheck()).resolves.toBe(false);
  });

  it('rejects inputs larger than the configured clamd StreamMaxLength before connecting', async () => {
    let connections = 0;
    const { port } = await fakeClamd(() => {
      connections += 1;
    });
    const { scanner, input } = await scannerFixture(port, Buffer.from('too large'), {
      streamMaximumBytes: 4,
    });

    await expect(scanner.scan(input)).rejects.toMatchObject({ code: 'scanner-unavailable' });
    expect(connections).toBe(0);
  });

  it('fails closed when the streamed bytes do not match the caller-supplied digest', async () => {
    let completed = false;
    const { port } = await fakeClamd((socket) => {
      parseInstream(socket, () => {
        completed = true;
        socket.write(Buffer.from('stream: OK\0', 'ascii'));
      });
    });
    const { scanner, input } = await scannerFixture(port, Buffer.from('digest-bound'));

    await expect(
      scanner.scan({
        ...input,
        sha256: digestBytes(Buffer.from('different')),
      }),
    ).rejects.toMatchObject({ code: 'scanner-unavailable' });
    expect(completed).toBe(false);
  });
});

async function scannerFixture(
  port: number,
  bytes: Buffer,
  options: {
    readonly chunkBytes?: number;
    readonly scanTimeoutMilliseconds?: number;
    readonly signal?: AbortSignal;
    readonly streamMaximumBytes?: number;
  } = {},
) {
  const root = await createTestRoot();
  roots.push(root);
  const path = join(root, 'upload.bin');
  await writeFile(path, bytes, { mode: 0o600 });
  const scanner = new ClamdScanner({
    host: '127.0.0.1',
    port,
    connectTimeoutMilliseconds: 500,
    scanTimeoutMilliseconds: options.scanTimeoutMilliseconds ?? 1_000,
    streamMaximumBytes: options.streamMaximumBytes ?? Math.max(bytes.byteLength, 1),
    ...(options.chunkBytes === undefined ? {} : { chunkBytes: options.chunkBytes }),
    clock: () => fixedNow,
  });
  return {
    scanner,
    input: {
      path,
      mediaType: 'application/octet-stream',
      sha256: digestBytes(bytes),
      byteLength: bytes.byteLength,
      signal: options.signal ?? new AbortController().signal,
    },
  };
}

async function fakeClamd(
  onConnection: (socket: Socket) => void,
  options: { readonly versionResponse?: Buffer } = {},
): Promise<{ port: number }> {
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    const inspectCommand = (data: Buffer) => {
      pending = Buffer.concat([pending, data]);
      const terminator = pending.indexOf(0);
      if (terminator === -1) {
        return;
      }
      socket.off('data', inspectCommand);
      if (
        terminator === 'zVERSION'.length &&
        pending.subarray(0, terminator).equals(Buffer.from('zVERSION', 'ascii')) &&
        pending.byteLength === terminator + 1
      ) {
        socket.write(options.versionResponse ?? versionResponse);
        return;
      }
      socket.pause();
      socket.unshift(pending);
      onConnection(socket);
      socket.resume();
    };
    socket.on('data', inspectCommand);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return { port: (server.address() as AddressInfo).port };
}

function parseInstream(socket: Socket, complete: (chunks: Buffer[]) => void): void {
  const command = Buffer.from('zINSTREAM\0', 'ascii');
  let pending = Buffer.alloc(0);
  let commandRead = false;
  let expectedChunkBytes: number | undefined;
  const chunks: Buffer[] = [];
  socket.on('data', (data) => {
    pending = Buffer.concat([pending, data]);
    if (!commandRead) {
      if (pending.byteLength < command.byteLength) {
        return;
      }
      if (!pending.subarray(0, command.byteLength).equals(command)) {
        socket.destroy();
        return;
      }
      pending = pending.subarray(command.byteLength);
      commandRead = true;
    }
    while (true) {
      if (expectedChunkBytes === undefined) {
        if (pending.byteLength < 4) {
          return;
        }
        expectedChunkBytes = pending.readUInt32BE(0);
        pending = pending.subarray(4);
        if (expectedChunkBytes === 0) {
          complete(chunks);
          return;
        }
        if (expectedChunkBytes > 1_048_576) {
          socket.destroy();
          return;
        }
      }
      if (pending.byteLength < expectedChunkBytes) {
        return;
      }
      chunks.push(Buffer.from(pending.subarray(0, expectedChunkBytes)));
      pending = pending.subarray(expectedChunkBytes);
      expectedChunkBytes = undefined;
    }
  });
}
