import { getEphemeralPort } from './loopback-port.js';
import { afterEach, describe, expect, it } from 'vitest';

import { MultiRelayClient, type RelayGap } from '../src/client.js';
import { RelayServer } from '../src/relay-server.js';
import { alice, alternateTopic, makeEvent, makeSubscription, testNow } from './fixtures.js';

const servers: RelayServer[] = [];
const clients: MultiRelayClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
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
