import type { AddressInfo } from 'node:net';

import { getEphemeralPort } from './loopback-port.js';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type RawData } from 'ws';

import { MultiRelayClient, type RelayGap } from '../src/client.js';
import { RELAY_PATH, RELAY_POLICY } from '../src/policy.js';
import { verifyRelayEvent, verifySubscription, type SignedRelayEvent } from '../src/protocol.js';
import { RelayServer } from '../src/relay-server.js';
import { relayClientFrameSchema } from '../src/wire.js';
import {
  alice,
  alternateTopic,
  bob,
  carol,
  makeEvent,
  makeSubscription,
  testNow,
} from './fixtures.js';

const servers: RelayServer[] = [];
const maliciousServers: WebSocketServer[] = [];
const clients: MultiRelayClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await Promise.all(maliciousServers.splice(0).map(closeMaliciousServer));
});

describe('multi-relay client over real loopback WebSockets', () => {
  it('fails over, reconnects, verifies, deduplicates, and reports relay-local gaps', async () => {
    const unavailablePort = await getEphemeralPort();
    const relayA = await startRelay('relay-a');
    const relayB = await startRelay('relay-b');
    let subscriptionNonce = 0;
    const events: string[] = [];
    const gaps: RelayGap[] = [];
    const statuses: string[] = [];
    const client = new MultiRelayClient({
      urls: [
        `ws://127.0.0.1:${String(unavailablePort)}`,
        relayA.address().webSocketUrl,
        relayB.address().webSocketUrl,
      ],
      now: () => testNow,
      dangerouslyAllowUnverifiedAdvisoryEvents: true,
      reconnectBaseMilliseconds: 10,
      reconnectMaximumMilliseconds: 20,
      handshakeTimeoutMilliseconds: 500,
      subscriptionFactory: () => {
        subscriptionNonce += 1;
        return makeSubscription(alice, {
          now: new Date(testNow.getTime() + subscriptionNonce),
        });
      },
      onEvent: (frame) => {
        events.push(frame.eventId);
      },
      onGap: (gap) => gaps.push(gap),
      onStatus: (status) => statuses.push(status),
    });
    clients.push(client);

    await client.connect();
    expect(client.activeEndpoint).toBe(relayA.address().webSocketUrl);
    expect(client.endpointHealth()[0]?.failures).toBe(1);

    const duplicateAcrossRelays = makeEvent('new-post');
    client.publish(duplicateAcrossRelays);
    await waitUntil(() => events.length === 1);

    await relayA.stop();
    servers.splice(servers.indexOf(relayA), 1);
    await waitUntil(() => client.activeEndpoint === relayB.address().webSocketUrl, 3_000);
    expect(statuses).toContain('reconnecting');

    client.publish(duplicateAcrossRelays);
    await delay(75);
    expect(events).toHaveLength(1);

    client.publish(makeEvent('presence', { topic: alternateTopic }));
    client.publish(makeEvent('presence'));
    await waitUntil(() => events.length === 2);
    expect(gaps).toContainEqual({
      relayId: 'relay-b',
      expectedSequence: 2,
      receivedSequence: 3,
    });
  });

  it('does not deliver an event that expires during client-side key authorization', async () => {
    const relay = await startRelay('relay-expiry-recheck');
    const delivered: string[] = [];
    let now = new Date(testNow);
    let authorizationCalls = 0;
    let releaseAuthorization: (() => void) | undefined;
    const client = new MultiRelayClient({
      urls: [relay.address().webSocketUrl],
      now: () => now,
      reconnectBaseMilliseconds: 1_000,
      reconnectMaximumMilliseconds: 1_000,
      subscriptionFactory: () => makeSubscription(alice),
      authorizeEventKey: () => {
        authorizationCalls += 1;
        return new Promise<boolean>((resolve) => {
          releaseAuthorization = () => resolve(true);
        });
      },
      onEvent: (frame) => {
        delivered.push(frame.eventId);
      },
    });
    clients.push(client);
    await client.connect();

    const event = makeEvent('new-post');
    client.publish(event);
    await waitUntil(() => authorizationCalls === 1);
    now = new Date(Date.parse(event.message.expiresAt));
    releaseAuthorization?.();
    await delay(50);

    expect(delivered).toEqual([]);
  });

  it('serializes client-side authorization and preserves relay sequence order', async () => {
    const relay = await startRelay('relay-client-serialization');
    const deliveredNonces: string[] = [];
    const releases: (() => void)[] = [];
    let authorizationCalls = 0;
    const client = new MultiRelayClient({
      urls: [relay.address().webSocketUrl],
      now: () => testNow,
      subscriptionFactory: () => makeSubscription(alice),
      authorizeEventKey: () => {
        authorizationCalls += 1;
        return new Promise<boolean>((resolve) => {
          releases.push(() => resolve(true));
        });
      },
      onEvent: (frame) => {
        deliveredNonces.push(frame.envelope.message.nonce);
      },
    });
    clients.push(client);
    await client.connect();

    const first = makeEvent('new-post');
    const second = makeEvent('new-post');
    client.publish(first);
    client.publish(second);
    await waitUntil(() => authorizationCalls === 1);
    await delay(20);
    expect(authorizationCalls).toBe(1);
    releases.shift()?.();
    await waitUntil(() => authorizationCalls === 2);
    releases.shift()?.();
    await waitUntil(() => deliveredNonces.length === 2);

    expect(deliveredNonces).toEqual([first.message.nonce, second.message.nonce]);
    expect(client.lastSequenceByRelay().get('relay-client-serialization')).toBe(2);
  });

  it('disconnects a relay that overflows the bounded client frame queue', async () => {
    const relay = await startRelay('relay-client-backpressure');
    const delivered: string[] = [];
    let authorizationCalls = 0;
    let releaseAuthorization: (() => void) | undefined;
    const client = new MultiRelayClient({
      urls: [relay.address().webSocketUrl],
      now: () => testNow,
      reconnectBaseMilliseconds: 10_000,
      reconnectMaximumMilliseconds: 10_000,
      subscriptionFactory: () => makeSubscription(alice),
      authorizeEventKey: () => {
        authorizationCalls += 1;
        return new Promise<boolean>((resolve) => {
          releaseAuthorization = () => resolve(true);
        });
      },
      onEvent: (frame) => {
        delivered.push(frame.eventId);
      },
    });
    clients.push(client);
    await client.connect();

    client.publish(makeEvent('new-post'));
    await waitUntil(() => authorizationCalls === 1);
    const additionalPublishes = Math.ceil((RELAY_POLICY.connection.maximumPendingFrames + 1) / 2);
    for (let index = 0; index < additionalPublishes; index += 1) {
      client.publish(makeEvent('new-post'));
      await delay(10);
    }
    await waitUntil(() => client.status === 'disconnected');
    releaseAuthorization?.();
    await delay(20);

    expect(authorizationCalls).toBe(1);
    expect(delivered).toEqual([]);
  });

  it('does not checkpoint an event when the application delivery callback fails', async () => {
    const relay = await startRelay('relay-delivery-failure');
    let deliveryAttempts = 0;
    const client = new MultiRelayClient({
      urls: [relay.address().webSocketUrl],
      now: () => testNow,
      reconnectBaseMilliseconds: 10_000,
      reconnectMaximumMilliseconds: 10_000,
      subscriptionFactory: () => makeSubscription(alice),
      authorizeEventKey: () => true,
      onEvent: () => {
        deliveryAttempts += 1;
        throw new Error('application persistence failed');
      },
    });
    clients.push(client);
    await client.connect();

    client.publish(makeEvent('new-post'));
    await waitUntil(() => client.status === 'disconnected');

    expect(deliveryAttempts).toBe(1);
    expect(client.lastSequenceByRelay().has('relay-delivery-failure')).toBe(false);
  });

  it.each([
    {
      violation: 'an unsubscribed topic',
      subscription: () => makeSubscription(bob, { kinds: ['new-post'] }),
      event: () => makeEvent('new-post', { topic: alternateTopic }),
    },
    {
      violation: 'an unsubscribed kind',
      subscription: () => makeSubscription(bob, { kinds: ['new-post'] }),
      event: () => makeEvent('presence'),
    },
    {
      violation: 'an unrelated direct audience',
      subscription: () => makeSubscription(bob, { kinds: ['encrypted-message'] }),
      event: () =>
        makeEvent('encrypted-message', {
          audience: { kind: 'identity', recipients: [carol.identityId] },
        }),
    },
  ])('disconnects a malicious relay that delivers $violation', async ({ event, subscription }) => {
    const relayId = 'malicious-scope-relay';
    const endpoint = await startMaliciousRelay(relayId, event());
    const delivered: string[] = [];
    const client = new MultiRelayClient({
      urls: [endpoint],
      now: () => testNow,
      dangerouslyAllowUnverifiedAdvisoryEvents: true,
      reconnectBaseMilliseconds: 10_000,
      reconnectMaximumMilliseconds: 10_000,
      subscriptionFactory: subscription,
      onEvent: (frame) => {
        delivered.push(frame.eventId);
      },
    });
    clients.push(client);

    await client.connect();
    await waitUntil(() => client.status === 'disconnected');

    expect(delivered).toEqual([]);
    expect(client.lastSequenceByRelay().has(relayId)).toBe(false);
  });

  it('refuses credential-bearing or non-WebSocket relay URLs', () => {
    const options = {
      subscriptionFactory: () => makeSubscription(alice),
      onEvent: () => undefined,
      dangerouslyAllowUnverifiedAdvisoryEvents: true as const,
    };
    expect(() => new MultiRelayClient({ ...options, urls: ['https://relay.example'] })).toThrow();
    expect(
      () => new MultiRelayClient({ ...options, urls: ['wss://user:secret@relay.example'] }),
    ).toThrow();
    expect(() => new MultiRelayClient({ ...options, urls: [] })).toThrow();
  });

  it('fails closed without application-side key authorization', () => {
    expect(
      () =>
        new MultiRelayClient({
          urls: ['wss://relay.example'],
          subscriptionFactory: () => makeSubscription(alice),
          onEvent: () => undefined,
        }),
    ).toThrow(/require a key authorizer/u);
  });
});

async function startRelay(relayId: string): Promise<RelayServer> {
  const relay = new RelayServer({
    host: '127.0.0.1',
    port: 0,
    relayId,
    logger: false,
    now: () => testNow,
    dangerouslyAllowUnverifiedLocalMode: true,
  });
  servers.push(relay);
  await relay.start();
  return relay;
}

async function startMaliciousRelay(relayId: string, event: SignedRelayEvent): Promise<string> {
  const verifiedEvent = await verifyRelayEvent(event, { now: testNow });
  const server = new WebSocketServer({
    host: '127.0.0.1',
    path: RELAY_PATH,
    perMessageDeflate: false,
    port: 0,
  });
  maliciousServers.push(server);
  server.on('connection', (socket) => {
    socket.send(
      JSON.stringify({
        op: 'hello',
        advisory: true,
        canonical: false,
        relayId,
        protocolVersion: 1,
        keyAuthorization: 'unverified-local',
        serverTime: testNow.toISOString(),
        limits: {
          maximumMessageBytes: RELAY_POLICY.message.maximumBytes,
          maximumSubscriptions: RELAY_POLICY.connection.maximumSubscriptions,
          retentionMilliseconds: RELAY_POLICY.retention.maximumMilliseconds,
        },
      }),
    );
    socket.once('message', (data, isBinary) => {
      void (async () => {
        if (isBinary) {
          throw new Error('Client sent an unexpected binary subscription.');
        }
        const frame = relayClientFrameSchema.parse(JSON.parse(rawDataText(data)));
        if (frame.op !== 'subscribe') {
          throw new Error('Client did not subscribe after the relay hello.');
        }
        const verifiedSubscription = await verifySubscription(frame.authorization, {
          now: testNow,
        });
        socket.send(
          JSON.stringify({
            op: 'subscribed',
            subscriptionId: verifiedSubscription.subscriptionId,
            topicCount: verifiedSubscription.envelope.message.subscriptions.length,
            expiresAt: verifiedSubscription.envelope.message.expiresAt,
          }),
        );
        socket.send(
          JSON.stringify({
            op: 'event',
            relayId,
            relaySequence: 1,
            receivedAt: testNow.toISOString(),
            retained: false,
            eventId: verifiedEvent.eventId,
            envelope: verifiedEvent.envelope,
            advisory: true,
            canonical: false,
            keyAuthorization: 'unverified-local',
          }),
        );
      })().catch(() => socket.close(1011, 'malicious test setup failed'));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  return `ws://127.0.0.1:${String(address.port)}${RELAY_PATH}`;
}

async function closeMaliciousServer(server: WebSocketServer): Promise<void> {
  for (const socket of server.clients) {
    socket.terminate();
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

function rawDataText(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  return data.toString('utf8');
}

async function waitUntil(predicate: () => boolean, timeoutMilliseconds = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(10);
  }
  throw new Error('Timed out waiting for relay client state.');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
