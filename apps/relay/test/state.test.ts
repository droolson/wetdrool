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

  it('evicts a full rate-limit keyspace with logarithmically bounded maintenance', () => {
    const maximumKeys = 20_000;
    const limiter = new SlidingWindowRateLimiter(1, 60_000, maximumKeys);
    for (let index = 0; index < maximumKeys; index += 1) {
      expect(limiter.allow(`identity-${String(index)}`, 10_000)).toBe(true);
    }

    const operationsBefore = limiter.maintenanceOperations;
    expect(limiter.allow('identity-over-capacity', 10_001)).toBe(true);
    const operationCost = limiter.maintenanceOperations - operationsBefore;

    expect(limiter.size).toBe(maximumKeys);
    expect(operationCost).toBeLessThanOrEqual(4 * Math.ceil(Math.log2(maximumKeys)) + 16);
  });

  it('rejects nonce replay per identity and allows it after expiry', () => {
    const replay = new ReplayWindow();
    expect(replay.accept('identity-a', 'nonce-a', 20_000, 10_000)).toBe(true);
    expect(replay.accept('identity-a', 'nonce-a', 20_000, 10_001)).toBe(false);
    expect(replay.accept('identity-b', 'nonce-a', 20_000, 10_001)).toBe(true);
    expect(replay.accept('identity-a', 'nonce-a', 30_000, 20_000)).toBe(true);
  });

  it('prunes replay expiries out of insertion order', () => {
    const replay = new ReplayWindow(4);
    expect(replay.accept('identity-a', 'late', 30_000, 1_000)).toBe(true);
    expect(replay.accept('identity-b', 'early', 10_000, 1_000)).toBe(true);
    expect(replay.accept('identity-c', 'middle', 20_000, 1_000)).toBe(true);

    expect(replay.accept('identity-b', 'early', 40_000, 10_000)).toBe(true);
    expect(replay.accept('identity-a', 'late', 40_000, 10_000)).toBe(false);
    expect(replay.size).toBe(3);
  });

  it('preserves expiry ordering when capacity eviction removes a non-minimum entry', () => {
    const replay = new ReplayWindow(3);
    expect(replay.accept('identity-a', 'oldest-insert', 50_000, 1_000)).toBe(true);
    expect(replay.accept('identity-b', 'first-expiry', 10_000, 1_000)).toBe(true);
    expect(replay.accept('identity-c', 'middle-expiry', 30_000, 1_000)).toBe(true);
    expect(replay.accept('identity-d', 'new-capacity-entry', 40_000, 1_001)).toBe(true);

    expect(replay.accept('identity-b', 'first-expiry', 60_000, 10_000)).toBe(true);
    expect(replay.accept('identity-c', 'middle-expiry', 60_000, 29_999)).toBe(false);
    expect(replay.accept('identity-c', 'middle-expiry', 60_000, 30_000)).toBe(true);
    expect(replay.accept('identity-d', 'new-capacity-entry', 60_000, 30_000)).toBe(false);
    expect(replay.size).toBe(3);
  });

  it('evicts a full replay keyspace with logarithmically bounded maintenance', () => {
    const maximumNonces = 20_000;
    const replay = new ReplayWindow(maximumNonces);
    for (let index = 0; index < maximumNonces; index += 1) {
      expect(replay.accept('identity', `nonce-${String(index)}`, 70_000, 10_000)).toBe(true);
    }

    const operationsBefore = replay.maintenanceOperations;
    expect(replay.accept('identity', 'nonce-over-capacity', 70_000, 10_001)).toBe(true);
    const operationCost = replay.maintenanceOperations - operationsBefore;

    expect(replay.size).toBe(maximumNonces);
    expect(operationCost).toBeLessThanOrEqual(4 * Math.ceil(Math.log2(maximumNonces)) + 16);
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
    expect(output).toContain('wetdrool_relay_active_connections 2');
    expect(output).toContain('wetdrool_relay_accepted_events_total 4');
    expect(output).not.toContain('wetdroolid:');
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
      relayId: 'wetdrool-relay',
      allowedOrigins: ['https://social.example', 'http://127.0.0.1:3000'],
      dangerouslyAllowUnverifiedLocalMode: false,
      trustedProxyCidrs: [],
    });
  });

  it.each([
    { APP_ENV: 'staging' as const },
    { APP_ENV: 'production' as const },
    { NODE_ENV: 'production' as const },
  ])('requires non-local HTTPS browser origins outside local development: %o', (mode) => {
    expect(() =>
      parseRelayConfig({
        ...mode,
        RELAY_ALLOWED_ORIGINS: 'http://app.example',
      }),
    ).toThrow(/non-local HTTPS/u);
    expect(() =>
      parseRelayConfig({
        ...mode,
        RELAY_ALLOWED_ORIGINS: 'https://localhost:3000',
      }),
    ).toThrow(/non-local HTTPS/u);
    expect(
      parseRelayConfig({
        ...mode,
        RELAY_ALLOWED_ORIGINS: 'https://wetdrool.com',
      }).allowedOrigins,
    ).toEqual(['https://wetdrool.com']);
  });

  it.each(['127.0.0.1', '[::1]', '[::ffff:7f00:1]', '[::]', 'app.localhost'])(
    'rejects local or unspecified HTTPS origin %s in staging',
    (hostname) => {
      expect(() =>
        parseRelayConfig({
          APP_ENV: 'staging',
          RELAY_ALLOWED_ORIGINS: `https://${hostname}`,
        }),
      ).toThrow(/non-local HTTPS/u);
    },
  );

  it('accepts only explicit trusted proxy IP/CIDR ranges', () => {
    expect(
      parseRelayConfig({
        TRUSTED_PROXY_CIDRS: '127.0.0.1/32,10.42.0.0/24',
      }).trustedProxyCidrs,
    ).toEqual(['127.0.0.1/32', '10.42.0.0/24']);
    expect(() => parseRelayConfig({ TRUSTED_PROXY_CIDRS: '0.0.0.0/0' })).toThrow(
      /TRUSTED_PROXY_CIDRS/u,
    );
  });

  it('rejects every database credential from the long-running process', () => {
    for (const variableName of ['MODERATION_DATABASE_MIGRATION_URL', 'MODERATION_DATABASE_URL']) {
      expect(() =>
        parseRelayConfig({
          [variableName]: 'postgresql://unrelated:secret@database.test/wetdrool',
        }),
      ).toThrow(/must not be injected/u);
    }
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
    expect(() =>
      parseRelayConfig({
        NODE_ENV: 'production',
        RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: '1',
      }),
    ).toThrow(/restricted to loopback development/u);
    expect(() =>
      parseRelayConfig({
        RELAY_HOST: '0.0.0.0',
        RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: '1',
      }),
    ).toThrow(/restricted to loopback development/u);
  });

  it('configures a bounded verified authorizer and rejects unsafe combinations', () => {
    const config = parseRelayConfig({
      RELAY_KEY_AUTHORIZER_URL: 'https://authorizer.example/v1/authorize-relay-key',
      RELAY_KEY_AUTHORIZER_BEARER_TOKEN: 'A'.repeat(32),
      RELAY_KEY_AUTHORIZER_TIMEOUT_MS: '750',
      RELAY_SUBSCRIPTION_AUTHORIZER_URL:
        'https://authorizer.example/v1/authorize-relay-subscription',
      RELAY_SUBSCRIPTION_AUTHORIZER_BEARER_TOKEN: 'S'.repeat(32),
      RELAY_SUBSCRIPTION_AUTHORIZER_TIMEOUT_MS: '900',
    });
    expect(config.keyAuthorizer).toEqual({
      endpoint: 'https://authorizer.example/v1/authorize-relay-key',
      readinessEndpoint: 'https://authorizer.example/readyz',
      bearerToken: 'A'.repeat(32),
      timeoutMilliseconds: 750,
    });
    expect(config.subscriptionAuthorizer).toEqual({
      endpoint: 'https://authorizer.example/v1/authorize-relay-subscription',
      readinessEndpoint: 'https://authorizer.example/readyz',
      bearerToken: 'S'.repeat(32),
      timeoutMilliseconds: 900,
    });
    expect(() =>
      parseRelayConfig({
        RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: '1',
        RELAY_KEY_AUTHORIZER_URL: 'http://127.0.0.1:4600/v1/authorize-relay-key',
      }),
    ).toThrow(/mutually exclusive/u);
    expect(() =>
      parseRelayConfig({
        NODE_ENV: 'production',
        RELAY_KEY_AUTHORIZER_URL: 'http://authorizer.example/v1/authorize-relay-key',
      }),
    ).toThrow(/non-local HTTPS when transport TLS is required/u);
    expect(() =>
      parseRelayConfig({
        RELAY_KEY_AUTHORIZER_BEARER_TOKEN: 'A'.repeat(32),
      }),
    ).toThrow(/authorizer URL is required/u);
    expect(() =>
      parseRelayConfig({
        RELAY_SUBSCRIPTION_AUTHORIZER_BEARER_TOKEN: 'S'.repeat(32),
      }),
    ).toThrow(/subscription-authorizer URL is required/u);
    expect(() =>
      parseRelayConfig({
        NODE_ENV: 'production',
        RELAY_SUBSCRIPTION_AUTHORIZER_URL:
          'http://authorizer.example/v1/authorize-relay-subscription',
      }),
    ).toThrow(/non-local HTTPS when transport TLS is required/u);
    expect(() =>
      parseRelayConfig({
        APP_ENV: 'staging',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        RELAY_KEY_AUTHORIZER_URL: 'https://authorizer.example/v1/authorize-relay-key',
      }),
    ).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED must not be 0/u);
    expect(() =>
      parseRelayConfig({
        RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: '1',
        RELAY_SUBSCRIPTION_AUTHORIZER_URL: 'http://127.0.0.1:4600/v1/authorize-relay-subscription',
      }),
    ).toThrow(/mutually exclusive/u);
    expect(() =>
      parseRelayConfig({
        RELAY_SUBSCRIPTION_AUTHORIZER_URL: 'https://user:secret@authorizer.example/v1/authorize',
      }),
    ).toThrow(/credential-free/u);
    expect(() =>
      parseRelayConfig({
        RELAY_SUBSCRIPTION_AUTHORIZER_URL: 'https://authorizer.example/v1/authorize#fragment',
      }),
    ).toThrow(/without fragments/u);
    expect(() =>
      parseRelayConfig({
        RELAY_SUBSCRIPTION_AUTHORIZER_URL: 'https://authorizer.example/v1/authorize',
        RELAY_SUBSCRIPTION_AUTHORIZER_BEARER_TOKEN: 'short',
      }),
    ).toThrow();
  });

  it.each(['127.0.0.1', '[::1]', '[::ffff:7f00:1]', '[::]', 'authorizer.localhost'])(
    'rejects local or unspecified authorizer host %s outside local development',
    (hostname) => {
      for (const variableName of [
        'RELAY_KEY_AUTHORIZER_URL',
        'RELAY_KEY_AUTHORIZER_READINESS_URL',
        'RELAY_SUBSCRIPTION_AUTHORIZER_URL',
        'RELAY_SUBSCRIPTION_AUTHORIZER_READINESS_URL',
      ] as const) {
        const base = variableName.startsWith('RELAY_KEY_')
          ? {
              RELAY_KEY_AUTHORIZER_URL: 'https://authorizer.example/v1/authorize-relay-key',
            }
          : {
              RELAY_SUBSCRIPTION_AUTHORIZER_URL:
                'https://authorizer.example/v1/authorize-relay-subscription',
            };
        expect(() =>
          parseRelayConfig({
            ...base,
            APP_ENV: 'staging',
            [variableName]: `https://${hostname}/v1/authorize`,
          }),
        ).toThrow(/non-local HTTPS when transport TLS is required/u);
      }
    },
  );

  it('rejects invalid ports, origins, and relay identifiers', () => {
    expect(() => parseRelayConfig({ RELAY_PORT: '0' })).toThrow();
    expect(() => parseRelayConfig({ RELAY_ALLOWED_ORIGINS: 'ws://relay.example' })).toThrow();
    expect(() =>
      parseRelayConfig({ RELAY_ALLOWED_ORIGINS: 'https://user:secret@relay.example' }),
    ).toThrow();
    expect(() =>
      parseRelayConfig({ RELAY_ALLOWED_ORIGINS: 'https://www.droolhouse.com' }),
    ).toThrow(/legacy redirect host/);
    expect(() =>
      parseRelayConfig({ RELAY_ALLOWED_ORIGINS: 'https://WWW.SOCIALLYWOKE.COM..' }),
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
