import WebSocket, { type RawData } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';

import { RelayServer } from '../src/relay-server.js';
import { relayServerFrameSchema, type RelayServerFrame } from '../src/wire.js';
import {
  alice,
  aliceImpersonator,
  bob,
  carol,
  makeEvent,
  makeSubscription,
  publicTopic,
  testNow,
} from './fixtures.js';

const servers: RelayServer[] = [];
const sockets: LoopbackSocket[] = [];

afterEach(async () => {
  await Promise.all(sockets.splice(0).map((socket) => socket.close()));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe('relay server over loopback WebSockets', () => {
  it('serves privacy-safe liveness, readiness, policy, and aggregate metrics', async () => {
    const { server, address } = await startRelay();

    const health = await fetch(`${address.httpUrl}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      ok: true,
      service: '@wokesocial/relay',
      advisory: true,
      canonical: false,
      relayId: address.relayId,
      keyAuthorization: 'unverified-local',
    });

    const ready = await fetch(`${address.httpUrl}/readyz`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      ok: true,
      keyAuthorization: 'unverified-local',
    });
    const policy = await (await fetch(`${address.httpUrl}/v1/policy`)).json();
    expect(policy).toMatchObject({ advisory: true, canonical: false });
    const metrics = await (await fetch(`${address.httpUrl}/metrics`)).text();
    expect(metrics).toContain('wokesocial_relay_active_connections');
    expect(metrics).not.toContain(alice.identityId);
    expect(server.metrics()).toMatchObject({
      activeConnections: 0,
      acceptedConnections: 0,
    });
  });

  it('authenticates subscriptions and routes a signed direct event only to its audience', async () => {
    const { server, address } = await startRelay();
    const aliceSocket = await connect(address.webSocketUrl);
    const bobSocket = await connect(address.webSocketUrl);
    const carolSocket = await connect(address.webSocketUrl);
    await authenticate(aliceSocket, makeSubscription(alice));
    await authenticate(bobSocket, makeSubscription(bob));
    await authenticate(carolSocket, makeSubscription(carol));

    const event = makeEvent('encrypted-message', {
      identity: alice,
      audience: { kind: 'identity', recipients: [bob.identityId] },
    });
    aliceSocket.send({ op: 'publish', envelope: event });

    const published = await aliceSocket.waitFor((frame) => frame.op === 'published');
    expect(published).toMatchObject({
      advisory: true,
      canonical: false,
      keyAuthorization: 'unverified-local',
    });
    expect(await aliceSocket.waitFor((frame) => frame.op === 'event')).toMatchObject({
      envelope: { message: { kind: 'encrypted-message' } },
    });
    expect(await bobSocket.waitFor((frame) => frame.op === 'event')).toMatchObject({
      envelope: { message: { identity: alice.identityId } },
    });
    await delay(50);
    expect(carolSocket.frames().some((frame) => frame.op === 'event')).toBe(false);
    expect(server.metrics()).toMatchObject({
      acceptedConnections: 3,
      acceptedEvents: 1,
      activeConnections: 3,
    });
  });

  it('does not treat knowledge of an opaque topic as community membership', async () => {
    const { address } = await startRelay();
    const publisher = await connect(address.webSocketUrl);
    const observer = await connect(address.webSocketUrl);
    await authenticate(publisher, makeSubscription(alice));
    await authenticate(observer, makeSubscription(bob));

    publisher.send({ op: 'publish', envelope: makeEvent('community-update') });
    await publisher.waitFor((frame) => frame.op === 'published');
    await delay(50);

    expect(
      observer
        .frames()
        .some(
          (frame) => frame.op === 'event' && frame.envelope.message.kind === 'community-update',
        ),
    ).toBe(false);
    expect(
      publisher
        .frames()
        .some(
          (frame) => frame.op === 'event' && frame.envelope.message.kind === 'community-update',
        ),
    ).toBe(false);
  });

  it('rejects replayed and signature-tampered publishes without echoing payloads', async () => {
    const { address } = await startRelay();
    const socket = await connect(address.webSocketUrl);
    await authenticate(socket, makeSubscription(alice));
    const event = makeEvent('new-post');

    socket.send({ op: 'publish', envelope: event });
    await socket.waitFor((frame) => frame.op === 'published');
    await socket.waitFor((frame) => frame.op === 'event');
    socket.send({ op: 'publish', envelope: event });
    expect(await socket.waitFor((frame) => frame.op === 'error')).toMatchObject({
      code: 'replay',
    });

    const tampered = structuredClone(makeEvent('presence'));
    tampered.proof.signature = makeEvent('new-post').proof.signature;
    socket.send({ op: 'publish', envelope: tampered });
    expect(
      await socket.waitFor((frame) => frame.op === 'error' && frame.code === 'invalid-signature'),
    ).toMatchObject({ code: 'invalid-signature' });
  });

  it('replays only eligible bounded retained events to a late authorized subscriber', async () => {
    const { address } = await startRelay();
    const publisher = await connect(address.webSocketUrl);
    await authenticate(publisher, makeSubscription(alice));
    const retained = makeEvent('new-post');
    const notRetained = makeEvent('presence');
    publisher.send({ op: 'publish', envelope: retained });
    await publisher.waitFor((frame) => frame.op === 'published');
    publisher.send({ op: 'publish', envelope: notRetained });
    await publisher.waitFor(
      (frame) => frame.op === 'published' && frame.eventId !== undefined,
      2_000,
      2,
    );

    const late = await connect(address.webSocketUrl);
    await authenticate(late, makeSubscription(bob, { sinceSequence: 0 }));
    const replay = await late.waitFor((frame) => frame.op === 'event');
    expect(replay).toMatchObject({
      retained: true,
      envelope: { message: { kind: 'new-post' } },
    });
    await delay(50);
    expect(
      late
        .frames()
        .some((frame) => frame.op === 'event' && frame.envelope.message.kind === 'presence'),
    ).toBe(false);
  });

  it('uses real WebSocket max-payload enforcement for oversized frames', async () => {
    const { address } = await startRelay();
    const socket = await connect(address.webSocketUrl);
    socket.raw.send('x'.repeat(70 * 1_024));
    const code = await socket.waitForClose();
    expect([1009, 1006]).toContain(code);
  });

  it('supports deployment authorization callbacks without claiming on-chain authority', async () => {
    const server = new RelayServer({
      host: '127.0.0.1',
      port: 0,
      relayId: 'authorized-loopback',
      logger: false,
      now: () => testNow,
      authorizeKey: ({ identityId, keyId }) =>
        identityId === alice.identityId && keyId === alice.keyId,
      authorizeSubscription: ({ topic }) => topic === publicTopic,
    });
    servers.push(server);
    const address = await server.start();
    const socket = await connect(address.webSocketUrl, 'verified');

    socket.send({ op: 'subscribe', authorization: makeSubscription(bob) });
    expect(await socket.waitFor((frame) => frame.op === 'error')).toMatchObject({
      code: 'forbidden',
    });
    socket.send({
      op: 'subscribe',
      authorization: makeSubscription(aliceImpersonator),
    });
    expect(
      await socket.waitFor((frame) => frame.op === 'error' && frame.code === 'forbidden', 2_000, 2),
    ).toMatchObject({ code: 'forbidden' });
    socket.send({ op: 'subscribe', authorization: makeSubscription(alice) });
    expect(await socket.waitFor((frame) => frame.op === 'subscribed')).toMatchObject({
      topicCount: 1,
    });
  });

  it('is locked and not ready by default when no real key authorizer exists', async () => {
    const server = new RelayServer({
      host: '127.0.0.1',
      port: 0,
      relayId: 'locked-loopback',
      logger: false,
      now: () => testNow,
    });
    servers.push(server);
    const address = await server.start();

    const ready = await fetch(`${address.httpUrl}/readyz`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({
      ok: false,
      relayId: 'locked-loopback',
      keyAuthorization: 'locked',
    });
    expect(await rejectedUpgradeStatus(address.webSocketUrl)).toBe(503);
    expect(server.metrics()).toMatchObject({
      acceptedConnections: 0,
      rejectedConnections: 1,
    });
  });
});

async function startRelay() {
  const server = new RelayServer({
    host: '127.0.0.1',
    port: 0,
    relayId: `loopback-${servers.length + 1}`,
    logger: false,
    now: () => testNow,
    dangerouslyAllowUnverifiedLocalMode: true,
  });
  servers.push(server);
  return { server, address: await server.start() };
}

async function connect(
  url: string,
  keyAuthorization: 'unverified-local' | 'verified' = 'unverified-local',
): Promise<LoopbackSocket> {
  const socket = new LoopbackSocket(url);
  sockets.push(socket);
  await socket.open();
  expect(await socket.waitFor((frame) => frame.op === 'hello')).toMatchObject({
    advisory: true,
    canonical: false,
    keyAuthorization,
  });
  return socket;
}

async function rejectedUpgradeStatus(url: string): Promise<number> {
  const socket = new WebSocket(url);
  socket.on('error', () => undefined);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out waiting for rejected relay upgrade.'));
    }, 2_000);
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      const status = response.statusCode;
      response.destroy();
      socket.terminate();
      resolve(status ?? 0);
    });
    socket.once('open', () => {
      clearTimeout(timer);
      socket.close();
      reject(new Error('Locked relay unexpectedly accepted a WebSocket upgrade.'));
    });
  });
}

async function authenticate(
  socket: LoopbackSocket,
  authorization: ReturnType<typeof makeSubscription>,
) {
  socket.send({ op: 'subscribe', authorization });
  return socket.waitFor((frame) => frame.op === 'subscribed');
}

class LoopbackSocket {
  readonly raw: WebSocket;
  readonly #frames: RelayServerFrame[] = [];
  readonly #waiters = new Set<() => void>();

  constructor(url: string) {
    this.raw = new WebSocket(url, { perMessageDeflate: false });
    this.raw.on('message', (data, isBinary) => this.#onMessage(data, isBinary));
  }

  async open(): Promise<void> {
    if (this.raw.readyState === WebSocket.OPEN) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.raw.once('open', resolve);
      this.raw.once('error', reject);
    });
  }

  send(value: unknown): void {
    this.raw.send(JSON.stringify(value));
  }

  frames(): readonly RelayServerFrame[] {
    return [...this.#frames];
  }

  async waitFor(
    predicate: (frame: RelayServerFrame) => boolean,
    timeoutMilliseconds = 2_000,
    occurrence = 1,
  ): Promise<RelayServerFrame> {
    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
      const matches = this.#frames.filter(predicate);
      const result = matches[occurrence - 1];
      if (result !== undefined) {
        return result;
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => {
            this.#waiters.delete(wake);
            reject(new Error('Timed out waiting for relay frame.'));
          },
          Math.max(1, deadline - Date.now()),
        );
        const wake = () => {
          clearTimeout(timer);
          this.#waiters.delete(wake);
          resolve();
        };
        this.#waiters.add(wake);
      });
    }
    throw new Error('Timed out waiting for relay frame.');
  }

  async waitForClose(): Promise<number> {
    if (this.raw.readyState === WebSocket.CLOSED) {
      return 1006;
    }
    return new Promise((resolve) => {
      this.raw.once('close', (code) => resolve(code));
    });
  }

  async close(): Promise<void> {
    if (this.raw.readyState === WebSocket.CLOSED) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.raw.terminate();
        resolve();
      }, 500);
      this.raw.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      this.raw.close();
    });
  }

  #onMessage(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      throw new Error('Unexpected binary relay frame.');
    }
    const parsed = relayServerFrameSchema.parse(
      JSON.parse(new TextDecoder().decode(rawDataBytes(data))),
    );
    this.#frames.push(parsed);
    for (const wake of this.#waiters) {
      wake();
    }
  }
}

function rawDataBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }
  return new Uint8Array(data);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
