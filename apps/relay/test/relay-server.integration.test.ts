import { randomBytes } from 'node:crypto';
import { connect as connectTcp, type Socket } from 'node:net';

import WebSocket, { type RawData } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createRuntimeRateLimiter,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimiterHealth,
  type RateLimitRequest,
} from '@wetdrool/rate-limit';

import { combineRelayReadinessChecks } from '../src/http-authorizer-client.js';
import { HttpRelaySubscriptionAuthorizer } from '../src/http-subscription-authorizer.js';
import { RELAY_POLICY } from '../src/policy.js';
import { signSubscription, unsignedSubscriptionSchema } from '../src/protocol.js';
import { RelayServer, type RelayLogger } from '../src/relay-server.js';
import { privacyHash } from '../src/state.js';
import { relayServerFrameSchema, type RelayServerFrame } from '../src/wire.js';
import {
  alice,
  aliceImpersonator,
  alternateTopic,
  bob,
  carol,
  freshFixtureNonce,
  makeEvent,
  makeSubscription,
  publicTopic,
  testNow,
} from './fixtures.js';

const servers: RelayServer[] = [];
const sockets: LoopbackSocket[] = [];
const transportSockets: Socket[] = [];

afterEach(async () => {
  await Promise.all(sockets.splice(0).map((socket) => socket.close()));
  await Promise.all(transportSockets.splice(0).map(closeTransportSocket));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe('relay server over loopback WebSockets', () => {
  it('serves privacy-safe liveness, readiness, policy, and aggregate metrics', async () => {
    const { server, address } = await startRelay();

    const health = await fetch(`${address.httpUrl}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      ok: true,
      service: '@wetdrool/relay',
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
    expect(policy).toMatchObject({
      advisory: true,
      canonical: false,
      connection: {
        connectionsCheckingIntervalMilliseconds: 250,
        headersTimeoutMilliseconds: 5_000,
        keepAliveTimeoutMilliseconds: 5_000,
        maximumHeaderBytes: 16 * 1_024,
        maximumHeadersCount: 64,
        maximumTransportSockets: 128,
        requestTimeoutMilliseconds: 10_000,
      },
    });
    const metrics = await (await fetch(`${address.httpUrl}/metrics`)).text();
    expect(metrics).toContain('wetdrool_relay_active_connections');
    expect(metrics).not.toContain(alice.identityId);
    expect(server.metrics()).toMatchObject({
      activeConnections: 0,
      acceptedConnections: 0,
    });
  });

  it('uses the shared limiter for the exact IP and identity policy buckets', async () => {
    const requests: RateLimitRequest[] = [];
    const limiter = testRateLimiter({
      consume: (request) => {
        requests.push(request);
        return decision(request, request.namespace !== 'relay:publish:identity');
      },
    });
    const { address } = await startRelay({ rateLimiter: limiter });
    expect((await fetch(`${address.httpUrl}/healthz`)).status).toBe(200);
    expect((await fetch(`${address.httpUrl}/readyz`)).status).toBe(200);
    const socket = await connect(address.webSocketUrl);
    await authenticate(socket, makeSubscription(alice));

    socket.send({ op: 'publish', envelope: makeEvent('presence') });
    expect(await socket.waitFor((frame) => frame.op === 'error')).toMatchObject({
      code: 'rate-limit',
      retryable: true,
    });
    expect(requests).toEqual([
      {
        namespace: 'relay:message:ip',
        key: '127.0.0.1',
        limit: RELAY_POLICY.rateLimit.ipMessagesPerMinute,
        windowMs: 60_000,
      },
      {
        namespace: 'relay:message:ip',
        key: '127.0.0.1',
        limit: RELAY_POLICY.rateLimit.ipMessagesPerMinute,
        windowMs: 60_000,
      },
      {
        namespace: 'relay:publish:identity',
        key: alice.identityId,
        limit: RELAY_POLICY.rateLimit.identityMessagesPerMinute,
        windowMs: 60_000,
      },
    ]);
  });

  it.each(['ip', 'identity'] as const)(
    'closes with 1011 when the shared %s limiter path rejects',
    async (failurePath) => {
      const limiter = testRateLimiter({
        consume: (request) => {
          if (
            (failurePath === 'ip' && request.namespace === 'relay:message:ip') ||
            (failurePath === 'identity' && request.namespace === 'relay:publish:identity')
          ) {
            throw new Error('private backend failure');
          }
          return decision(request, true);
        },
      });
      const { address } = await startRelay({ rateLimiter: limiter });
      const socket = await connect(address.webSocketUrl);
      if (failurePath === 'identity') {
        await authenticate(socket, makeSubscription(alice));
      }

      const closed = socket.waitForClose();
      socket.send(
        failurePath === 'ip'
          ? { op: 'subscribe', authorization: makeSubscription(alice) }
          : { op: 'publish', envelope: makeEvent('presence') },
      );
      await expect(closed).resolves.toBe(1011);
      expect(
        socket.frames().some((frame) => frame.op === 'error' && frame.code === 'invalid-signature'),
      ).toBe(false);
    },
  );

  it('keeps liveness reachable and readiness closed when the shared limiter is unavailable', async () => {
    const limiter = testRateLimiter({ ready: false });
    const { address } = await startRelay({ rateLimiter: limiter });

    expect((await fetch(`${address.httpUrl}/healthz`)).status).toBe(200);
    expect((await fetch(`${address.httpUrl}/readyz`)).status).toBe(503);
  });

  it('shares an identity publish quota through two relay replicas and two Redis clients', async () => {
    const suffix = randomBytes(6).toString('hex');
    const deploymentId = `relay-${suffix}`;
    const redisUrl =
      process.env['RATE_LIMIT_INTEGRATION_REDIS_URL'] ??
      'redis://:local-development-only@127.0.0.1:6379';
    const config = {
      backend: 'redis',
      deploymentId,
      keySecret: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
      redisUrl,
    } as const;
    const [limiterA, limiterB] = await Promise.all([
      createRuntimeRateLimiter({ config, serviceId: 'relay-integration' }),
      createRuntimeRateLimiter({ config, serviceId: 'relay-integration' }),
    ]);
    const [{ address: addressA }, { address: addressB }] = await Promise.all([
      startRelay({ rateLimiter: limiterA }),
      startRelay({ rateLimiter: limiterB }),
    ]);
    const socketA = await connect(addressA.webSocketUrl);
    const socketB = await connect(addressB.webSocketUrl);
    await Promise.all([
      authenticate(socketA, makeSubscription(alice)),
      authenticate(socketB, makeSubscription(alice)),
    ]);

    const halfLimit = RELAY_POLICY.rateLimit.identityMessagesPerMinute / 2;
    expect(Number.isInteger(halfLimit)).toBe(true);
    for (let index = 0; index < halfLimit; index += 1) {
      socketA.send({ op: 'publish', envelope: makeEvent('presence') });
      socketB.send({ op: 'publish', envelope: makeEvent('presence') });
      await Promise.all([
        socketA.waitFor((frame) => frame.op === 'published', 2_000, index + 1),
        socketB.waitFor((frame) => frame.op === 'published', 2_000, index + 1),
      ]);
    }

    socketB.send({ op: 'publish', envelope: makeEvent('presence') });
    await expect(
      socketB.waitFor((frame) => frame.op === 'error' && frame.code === 'rate-limit', 5_000),
    ).resolves.toMatchObject({
      code: 'rate-limit',
      retryable: true,
    });
  }, 30_000);

  it(
    'closes an incomplete HTTP upgrade within the explicit header deadline',
    async () => {
      const { address } = await startRelay();
      const socket = await openTransportSocket(address.port);
      socket.write('GET /v1/relay HTTP/1.1\r\nHost: relay.test\r\nX-Incomplete:');
      const startedAt = Date.now();

      await waitForTransportClose(
        socket,
        RELAY_POLICY.connection.headersTimeoutMilliseconds +
          RELAY_POLICY.connection.connectionsCheckingIntervalMilliseconds +
          1_500,
      );

      expect(Date.now() - startedAt).toBeLessThanOrEqual(
        RELAY_POLICY.connection.headersTimeoutMilliseconds +
          RELAY_POLICY.connection.connectionsCheckingIntervalMilliseconds +
          1_000,
      );
    },
    RELAY_POLICY.connection.headersTimeoutMilliseconds + 3_000,
  );

  it('rejects upgrades when incomplete transports consume the global socket budget', async () => {
    const { server, address } = await startRelay();
    const held = await Promise.all(
      Array.from({ length: RELAY_POLICY.connection.maximumTransportSockets }, async () => {
        const socket = await openTransportSocket(address.port);
        socket.write('GET /v1/relay HTTP/1.1\r\nHost: relay.test\r\nX-Incomplete:');
        return socket;
      }),
    );
    await waitUntil(
      () => server.transportSocketCount() === RELAY_POLICY.connection.maximumTransportSockets,
    );

    await expectUpgradeTransportRejection(address.webSocketUrl);

    const released = held.pop();
    expect(released).toBeDefined();
    if (released !== undefined) {
      await closeTransportSocket(released);
    }
    await waitUntil(
      () => server.transportSocketCount() === RELAY_POLICY.connection.maximumTransportSockets - 1,
    );
    await connect(address.webSocketUrl);
  });

  it('omits stable identity-derived values from routine acceptance logs', async () => {
    const contexts: Readonly<Record<string, unknown>>[] = [];
    const logger: RelayLogger = {
      info: (context) => contexts.push(context),
      warn: (context) => contexts.push(context),
      error: (context) => contexts.push(context),
    };
    const server = new RelayServer({
      host: '127.0.0.1',
      port: 0,
      relayId: 'privacy-safe-logs',
      logger,
      now: () => testNow,
      dangerouslyAllowUnverifiedLocalMode: true,
    });
    servers.push(server);
    const address = await server.start();
    const socket = await connect(address.webSocketUrl);
    await authenticate(socket, makeSubscription(alice));
    socket.send({ op: 'publish', envelope: makeEvent('new-post') });
    await socket.waitFor((frame) => frame.op === 'published');

    const serialized = JSON.stringify(contexts);
    expect(serialized).not.toContain(alice.identityId);
    expect(serialized).not.toContain(privacyHash(alice.identityId));
    expect(contexts.every((context) => !('identityHash' in context))).toBe(true);
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

  it('rejects a subscription that expires while asynchronous authorization is in flight', async () => {
    let now = new Date(testNow);
    const server = new RelayServer({
      host: '127.0.0.1',
      port: 0,
      relayId: 'authorization-time-recheck',
      logger: false,
      now: () => now,
      authorizeKey: () => true,
      authorizeSubscription: ({ identityId }) => {
        if (identityId === bob.identityId) {
          now = new Date(testNow.getTime() + 5 * 60_000);
        }
        return true;
      },
    });
    servers.push(server);
    const address = await server.start();
    const publisher = await connect(address.webSocketUrl, 'verified');
    await authenticate(publisher, makeSubscription(alice));
    publisher.send({ op: 'publish', envelope: makeEvent('new-post') });
    await publisher.waitFor((frame) => frame.op === 'published');

    const late = await connect(address.webSocketUrl, 'verified');
    late.send({
      op: 'subscribe',
      authorization: makeSubscription(bob, { sinceSequence: 0 }),
    });
    expect(await late.waitFor((frame) => frame.op === 'error')).toMatchObject({
      message: 'Relay message has expired.',
    });
    await delay(50);
    expect(late.frames().some((frame) => frame.op === 'subscribed' || frame.op === 'event')).toBe(
      false,
    );
  });

  it('rejects the whole subscription when an early topic grant expires during later checks', async () => {
    let now = new Date(testNow);
    let bobAuthorizationCount = 0;
    const server = new RelayServer({
      host: '127.0.0.1',
      port: 0,
      relayId: 'topic-grant-time-recheck',
      logger: false,
      now: () => now,
      authorizeKey: () => true,
      authorizeSubscription: ({ identityId }) => {
        if (identityId !== bob.identityId) {
          return true;
        }
        bobAuthorizationCount += 1;
        if (bobAuthorizationCount === 1) {
          return { authorized: true, expiresAt: testNow.getTime() + 1_000 };
        }
        now = new Date(testNow.getTime() + 1_001);
        return { authorized: true, expiresAt: testNow.getTime() + 10_000 };
      },
    });
    servers.push(server);
    const address = await server.start();
    const publisher = await connect(address.webSocketUrl, 'verified');
    await authenticate(publisher, makeSubscription(alice));
    publisher.send({ op: 'publish', envelope: makeEvent('community-update') });
    await publisher.waitFor((frame) => frame.op === 'published');

    const template = makeSubscription(bob);
    const authorization = signSubscription(
      unsignedSubscriptionSchema.parse({
        ...template.message,
        nonce: freshFixtureNonce(),
        subscriptions: [
          {
            topic: publicTopic,
            kinds: ['community-update'],
            sinceSequence: 0,
          },
          {
            topic: alternateTopic,
            kinds: ['new-post'],
            sinceSequence: 0,
          },
        ],
      }),
      bob.privateKey,
    );
    const late = await connect(address.webSocketUrl, 'verified');
    late.send({ op: 'subscribe', authorization });
    expect(await late.waitFor((frame) => frame.op === 'error')).toMatchObject({
      code: 'forbidden',
      message: 'A requested subscription authorization expired before installation.',
    });
    await delay(50);
    expect(late.frames().some((frame) => frame.op === 'subscribed' || frame.op === 'event')).toBe(
      false,
    );
  });

  it('uses real WebSocket max-payload enforcement for oversized frames', async () => {
    const { address } = await startRelay();
    const socket = await connect(address.webSocketUrl);
    socket.raw.send('x'.repeat(70 * 1_024));
    const code = await socket.waitForClose();
    expect([1009, 1006]).toContain(code);
  });

  it('applies connection caps to canonical clients behind an allowlisted ingress', async () => {
    const server = new RelayServer({
      host: '127.0.0.1',
      port: 0,
      relayId: 'trusted-ingress-rate-limit',
      logger: false,
      now: () => testNow,
      dangerouslyAllowUnverifiedLocalMode: true,
      trustedProxyCidrs: ['127.0.0.1/32'],
    });
    servers.push(server);
    const address = await server.start();
    const firstClientHeaders = { 'x-forwarded-for': '203.0.113.10' };

    await Promise.all(
      Array.from({ length: RELAY_POLICY.connection.maximumConnectionsPerIp }, () =>
        connect(address.webSocketUrl, 'unverified-local', firstClientHeaders),
      ),
    );
    expect(await rejectedUpgradeStatus(address.webSocketUrl, firstClientHeaders)).toBe(429);
    await expect(
      connect(address.webSocketUrl, 'unverified-local', {
        'x-forwarded-for': '203.0.113.11',
      }),
    ).resolves.toBeInstanceOf(LoopbackSocket);
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

  it('expires finalized HTTP community grants without regressing public delivery', async () => {
    let now = new Date(testNow);
    let keyReady = true;
    let subscriptionReady = true;
    const networkId = alice.identityId.split(':').slice(2, -1).join(':');
    const authorizerFetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      if (init?.method === 'GET') {
        return new Response(JSON.stringify({ ok: subscriptionReady }), {
          status: subscriptionReady ? 200 : 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      const request = JSON.parse(String(init?.body)) as {
        requestId: string;
      };
      return new Response(
        JSON.stringify({
          version: 'wetdrool-relay-subscription-authorization-v1',
          requestId: request.requestId,
          authorized: true,
          finalized: true,
          networkId,
          checkpointSlot: '42',
          evaluatedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 10_000).toISOString(),
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    const subscriptionAuthorizer = new HttpRelaySubscriptionAuthorizer({
      endpoint: 'https://authorizer.example/v1/authorize-relay-subscription',
      readinessEndpoint: 'https://authorizer.example/readyz',
      bearerToken: 'S'.repeat(32),
      timeoutMilliseconds: 1_000,
      fetch: authorizerFetch,
      now: () => now,
    });
    const keyReadiness = vi.fn(async () => {
      if (!keyReady) {
        throw new Error('key projection unavailable');
      }
    });
    const readinessCheck = combineRelayReadinessChecks([
      keyReadiness,
      subscriptionAuthorizer.readinessCheck,
    ]);
    const server = new RelayServer({
      host: '127.0.0.1',
      port: 0,
      relayId: 'finalized-community-grants',
      logger: false,
      now: () => now,
      authorizeKey: () => true,
      authorizeSubscription: subscriptionAuthorizer.authorize,
      ...(readinessCheck === undefined ? {} : { readinessCheck }),
    });
    servers.push(server);
    const address = await server.start();

    let ready = await fetch(`${address.httpUrl}/readyz`);
    expect(ready.status).toBe(200);
    expect(keyReadiness).toHaveBeenCalledOnce();
    keyReady = false;
    ready = await fetch(`${address.httpUrl}/readyz`);
    expect(ready.status).toBe(503);
    keyReady = true;
    subscriptionReady = false;
    ready = await fetch(`${address.httpUrl}/readyz`);
    expect(ready.status).toBe(503);
    subscriptionReady = true;

    const publisher = await connect(address.webSocketUrl, 'verified');
    const observer = await connect(address.webSocketUrl, 'verified');
    await authenticate(publisher, makeSubscription(alice));
    await authenticate(observer, makeSubscription(bob));

    publisher.send({ op: 'publish', envelope: makeEvent('community-update') });
    await publisher.waitFor((frame) => frame.op === 'published');
    await observer.waitFor(
      (frame) => frame.op === 'event' && frame.envelope.message.kind === 'community-update',
    );
    const communityDeliveries = observer
      .frames()
      .filter(
        (frame) => frame.op === 'event' && frame.envelope.message.kind === 'community-update',
      ).length;

    now = new Date(testNow.getTime() + 10_001);
    publisher.send({
      op: 'publish',
      envelope: makeEvent('community-update', { now }),
    });
    await publisher.waitFor((frame) => frame.op === 'published', 2_000, 2);
    await delay(50);
    expect(
      observer
        .frames()
        .filter(
          (frame) => frame.op === 'event' && frame.envelope.message.kind === 'community-update',
        ),
    ).toHaveLength(communityDeliveries);

    publisher.send({ op: 'publish', envelope: makeEvent('new-post', { now }) });
    await observer.waitFor(
      (frame) => frame.op === 'event' && frame.envelope.message.kind === 'new-post',
    );
    publisher.send({ op: 'publish', envelope: makeEvent('encrypted-message', { now }) });
    await observer.waitFor(
      (frame) => frame.op === 'event' && frame.envelope.message.kind === 'encrypted-message',
    );
  });

  it('rejects malformed time-bounded subscription grants', async () => {
    const server = new RelayServer({
      host: '127.0.0.1',
      port: 0,
      relayId: 'malformed-community-grant',
      logger: false,
      now: () => testNow,
      authorizeKey: () => true,
      authorizeSubscription: () => ({ authorized: true, expiresAt: Number.NaN }),
    });
    servers.push(server);
    const address = await server.start();
    const socket = await connect(address.webSocketUrl, 'verified');

    socket.send({ op: 'subscribe', authorization: makeSubscription(alice) });
    expect(await socket.waitFor((frame) => frame.op === 'error')).toMatchObject({
      code: 'forbidden',
    });
  });

  it('serializes asynchronous frame authorization per connection', async () => {
    const releases: (() => void)[] = [];
    let activeAuthorizations = 0;
    let authorizationCalls = 0;
    let maximumActiveAuthorizations = 0;
    const server = new RelayServer({
      host: '127.0.0.1',
      port: 0,
      relayId: 'serialized-authorizer',
      logger: false,
      now: () => testNow,
      authorizeKey: ({ purpose }) => {
        if (purpose === 'subscribe') {
          return true;
        }
        authorizationCalls += 1;
        activeAuthorizations += 1;
        maximumActiveAuthorizations = Math.max(maximumActiveAuthorizations, activeAuthorizations);
        return new Promise<boolean>((resolve) => {
          releases.push(() => {
            activeAuthorizations -= 1;
            resolve(true);
          });
        });
      },
    });
    servers.push(server);
    const address = await server.start();
    const socket = await connect(address.webSocketUrl, 'verified');
    await authenticate(socket, makeSubscription(alice));

    socket.send({ op: 'publish', envelope: makeEvent('new-post') });
    socket.send({ op: 'publish', envelope: makeEvent('new-post') });
    socket.send({ op: 'publish', envelope: makeEvent('new-post') });

    await waitUntil(() => authorizationCalls === 1);
    await delay(20);
    expect(authorizationCalls).toBe(1);
    releases.shift()?.();
    await waitUntil(() => authorizationCalls === 2);
    releases.shift()?.();
    await waitUntil(() => authorizationCalls === 3);
    releases.shift()?.();
    await socket.waitFor((frame) => frame.op === 'published', 2_000, 3);

    expect(maximumActiveAuthorizations).toBe(1);
    expect(server.metrics().acceptedEvents).toBe(3);
  });

  it('disconnects an overflowing inbound queue and performs no post-close publish', async () => {
    let authorizationCalls = 0;
    let releaseAuthorization: (() => void) | undefined;
    const server = new RelayServer({
      host: '127.0.0.1',
      port: 0,
      relayId: 'bounded-inbound-queue',
      logger: false,
      now: () => testNow,
      authorizeKey: ({ purpose }) => {
        if (purpose === 'subscribe') {
          return true;
        }
        authorizationCalls += 1;
        return new Promise<boolean>((resolve) => {
          releaseAuthorization = () => resolve(true);
        });
      },
    });
    servers.push(server);
    const address = await server.start();
    const socket = await connect(address.webSocketUrl, 'verified');
    await authenticate(socket, makeSubscription(alice));

    socket.send({ op: 'publish', envelope: makeEvent('new-post') });
    for (let index = 0; index < RELAY_POLICY.connection.maximumPendingFrames + 1; index += 1) {
      socket.send({ op: 'publish', envelope: makeEvent('new-post') });
    }

    expect(await socket.waitFor((frame) => frame.op === 'error')).toMatchObject({
      code: 'backpressure',
      retryable: true,
    });
    expect(await socket.waitForClose()).toBe(4008);
    expect(authorizationCalls).toBe(1);
    releaseAuthorization?.();
    await delay(20);

    expect(authorizationCalls).toBe(1);
    expect(server.metrics()).toMatchObject({
      acceptedEvents: 0,
      backpressureDisconnects: 1,
    });
  });

  it('does not combine dangerous unverified keys with a subscription authorizer', () => {
    expect(
      () =>
        new RelayServer({
          dangerouslyAllowUnverifiedLocalMode: true,
          authorizeSubscription: () => true,
        }),
    ).toThrow(/never both/u);
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

async function startRelay(options: Readonly<{ rateLimiter?: RateLimiter }> = {}) {
  const server = new RelayServer({
    host: '127.0.0.1',
    port: 0,
    relayId: `loopback-${servers.length + 1}`,
    logger: false,
    now: () => testNow,
    dangerouslyAllowUnverifiedLocalMode: true,
    ...(options.rateLimiter === undefined ? {} : { rateLimiter: options.rateLimiter }),
  });
  servers.push(server);
  return { server, address: await server.start() };
}

function testRateLimiter(
  options: Readonly<{
    consume?: (request: RateLimitRequest) => RateLimitDecision | Promise<RateLimitDecision>;
    ready?: boolean;
  }> = {},
): RateLimiter {
  const ready = options.ready ?? true;
  const health = (): RateLimiterHealth => ({
    mode: 'redis',
    status: ready ? 'ready' : 'not-ready',
    ready,
    consecutiveFailures: ready ? 0 : 1,
    checkedAt: Date.now(),
    lastSuccessAt: ready ? Date.now() : null,
    lastFailureAt: ready ? null : Date.now(),
    errorCode: ready ? null : 'RATE_LIMIT_BACKEND_UNAVAILABLE',
  });
  return {
    consume: async (request) =>
      options.consume === undefined ? decision(request, true) : options.consume(request),
    read: async (request) => decision(request, true),
    readiness: async () => health(),
    health,
    close: async () => undefined,
  };
}

function decision(request: RateLimitRequest, allowed: boolean): RateLimitDecision {
  const count = allowed ? 1 : request.limit + 1;
  return {
    allowed,
    reason: allowed ? 'allowed' : 'limit-exceeded',
    count,
    limit: request.limit,
    remaining: Math.max(0, request.limit - count),
    resetAt: Date.now() + request.windowMs,
  };
}

async function openTransportSocket(port: number): Promise<Socket> {
  const socket = connectTcp({ host: '127.0.0.1', port });
  transportSockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    const onConnect = () => {
      socket.off('error', onError);
      resolve();
    };
    const onError = (error: Error) => {
      socket.off('connect', onConnect);
      reject(error);
    };
    socket.once('connect', onConnect);
    socket.once('error', onError);
  });
  socket.on('error', () => undefined);
  return socket;
}

async function closeTransportSocket(socket: Socket): Promise<void> {
  if (socket.destroyed) {
    return;
  }
  await new Promise<void>((resolve) => {
    socket.once('close', () => resolve());
    socket.destroy();
  });
}

async function waitForTransportClose(socket: Socket, timeoutMilliseconds: number): Promise<void> {
  if (socket.destroyed) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out waiting for the relay to close an incomplete transport.'));
    }, timeoutMilliseconds);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function expectUpgradeTransportRejection(url: string): Promise<void> {
  const socket = new WebSocket(url, { perMessageDeflate: false });
  socket.on('error', () => undefined);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (socket.readyState !== WebSocket.CLOSED) {
        socket.terminate();
      }
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };
    const timer = setTimeout(
      () => finish(new Error('Timed out waiting for the saturated relay to reject an upgrade.')),
      2_000,
    );
    socket.once('open', () =>
      finish(new Error('Relay accepted an upgrade beyond its global transport capacity.')),
    );
    socket.once('error', () => finish());
    socket.once('unexpected-response', (_request, response) => {
      response.destroy();
      finish();
    });
    socket.once('close', () => finish());
  });
}

async function connect(
  url: string,
  keyAuthorization: 'unverified-local' | 'verified' = 'unverified-local',
  headers?: Readonly<Record<string, string>>,
): Promise<LoopbackSocket> {
  const socket = new LoopbackSocket(url, headers);
  sockets.push(socket);
  await socket.open();
  expect(await socket.waitFor((frame) => frame.op === 'hello')).toMatchObject({
    advisory: true,
    canonical: false,
    keyAuthorization,
  });
  return socket;
}

async function rejectedUpgradeStatus(
  url: string,
  headers?: Readonly<Record<string, string>>,
): Promise<number> {
  const socket = new WebSocket(url, { ...(headers === undefined ? {} : { headers }) });
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

  constructor(url: string, headers?: Readonly<Record<string, string>>) {
    this.raw = new WebSocket(url, {
      perMessageDeflate: false,
      ...(headers === undefined ? {} : { headers }),
    });
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

async function waitUntil(predicate: () => boolean, timeoutMilliseconds = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for relay test condition.');
    }
    await delay(5);
  }
}
