import { describe, expect, it } from 'vitest';

import { parseRelayConfig } from '../src/config.js';
import {
  EphemeralEventStore,
  RelayMetrics,
  ReplayWindow,
  SlidingWindowRateLimiter,
} from '../src/state.js';
import type { RelayEventFrame } from '../src/wire.js';
import { makeEvent, testNow } from './fixtures.js';

describe('bounded relay state', () => {
  it('applies deterministic fixed-window rate limits', () => {
    const limiter = new SlidingWindowRateLimiter(2, 1_000);
    expect(limiter.allow('identity-hash', 10_000)).toBe(true);
    expect(limiter.allow('identity-hash', 10_001)).toBe(true);
    expect(limiter.allow('identity-hash', 10_002)).toBe(false);
    expect(limiter.allow('identity-hash', 11_000)).toBe(true);
  });

  it('rejects nonce replay per identity and allows it after expiry', () => {
    const replay = new ReplayWindow();
    expect(replay.accept('identity-a', 'nonce-a', 20_000, 10_000)).toBe(true);
    expect(replay.accept('identity-a', 'nonce-a', 20_000, 10_001)).toBe(false);
    expect(replay.accept('identity-b', 'nonce-a', 20_000, 10_001)).toBe(true);
    expect(replay.accept('identity-a', 'nonce-a', 30_000, 20_000)).toBe(true);
  });

  it('retains eligible advisory events but never presence', () => {
    const store = new EphemeralEventStore();
    const retained = makeEvent('new-post');
    const presence = makeEvent('presence');
    store.add(frame(retained, 1), retained, testNow.getTime());
    store.add(frame(presence, 2), presence, testNow.getTime());

    expect(store.size).toBe(1);
    expect(store.replay(retained.message.topic, 0, testNow.getTime())).toMatchObject([
      { retained: true, relaySequence: 1 },
    ]);
    expect(store.replay(retained.message.topic, 1, testNow.getTime())).toHaveLength(0);
    expect(store.replay(retained.message.topic, 0, testNow.getTime() + 3 * 60_000)).toHaveLength(0);
  });

  it('emits aggregate metrics without private relay content', () => {
    const metrics = new RelayMetrics();
    metrics.activeConnections = 2;
    metrics.acceptedEvents = 4;
    const output = metrics.prometheus('relay-public-id', 1, 'verified');
    expect(output).toContain('socially_woke_relay_active_connections 2');
    expect(output).toContain('socially_woke_relay_accepted_events_total 4');
    expect(output).not.toContain('swid:');
  });
});

describe('relay environment configuration', () => {
  it('normalizes browser origins and applies safe defaults', () => {
    expect(
      parseRelayConfig({
        RELAY_ALLOWED_ORIGINS:
          'https://social.example/path, https://social.example, http://127.0.0.1:3000',
      }),
    ).toEqual({
      host: '127.0.0.1',
      port: 4200,
      relayId: 'socially-woke-relay',
      allowedOrigins: ['https://social.example', 'http://127.0.0.1:3000'],
      dangerouslyAllowUnverifiedLocalMode: false,
    });
  });

  it('requires an unmistakable exact local-unverified opt-in', () => {
    expect(
      parseRelayConfig({
        RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: '1',
      }).dangerouslyAllowUnverifiedLocalMode,
    ).toBe(true);
    expect(() =>
      parseRelayConfig({
        RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: 'true',
      }),
    ).toThrow();
  });

  it('rejects invalid ports, origins, and relay identifiers', () => {
    expect(() => parseRelayConfig({ RELAY_PORT: '0' })).toThrow();
    expect(() => parseRelayConfig({ RELAY_ALLOWED_ORIGINS: 'ws://relay.example' })).toThrow();
    expect(() =>
      parseRelayConfig({ RELAY_ALLOWED_ORIGINS: 'https://user:secret@relay.example' }),
    ).toThrow();
    expect(() =>
      parseRelayConfig({ RELAY_ALLOWED_ORIGINS: 'https://www.sociallywoke.com' }),
    ).toThrow(/legacy redirect host/);
    expect(() => parseRelayConfig({ RELAY_ID: '../private' })).toThrow();
  });
});

function frame(envelope: ReturnType<typeof makeEvent>, relaySequence: number): RelayEventFrame {
  return {
    op: 'event',
    relayId: 'state-test',
    relaySequence,
    receivedAt: testNow.toISOString(),
    retained: false,
    eventId: `event-${String(relaySequence)}`,
    envelope,
    advisory: true,
    canonical: false,
    keyAuthorization: 'unverified-local',
  };
}
