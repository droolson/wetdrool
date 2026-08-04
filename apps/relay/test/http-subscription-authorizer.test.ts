import bs58 from 'bs58';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpRelaySubscriptionAuthorizer } from '../src/http-subscription-authorizer.js';
import { alice, publicTopic, testNow } from './fixtures.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const networkId = alice.identityId.split(':').slice(2, -1).join(':');
const alternateNetworkId = `droolnet:v1:${bs58.encode(
  Uint8Array.from({ length: 32 }, () => 8),
)}:${bs58.encode(Uint8Array.from({ length: 32 }, () => 9))}`;
const authorizationInput = {
  identityId: alice.identityId,
  topic: publicTopic,
  kinds: ['typing', 'new-post', 'typing'] as const,
};

afterEach(() => {
  vi.useRealTimers();
});

function authorizationResponse(
  overrides: Record<string, unknown> = {},
  init: ResponseInit = {},
): Response {
  return new Response(
    JSON.stringify({
      version: 'wetdrool-relay-subscription-authorization-v1',
      requestId,
      authorized: true,
      finalized: true,
      networkId,
      checkpointSlot: '42',
      evaluatedAt: testNow.toISOString(),
      expiresAt: new Date(testNow.getTime() + 10_000).toISOString(),
      ...overrides,
    }),
    {
      ...init,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...Object.fromEntries(new Headers(init.headers)),
      },
    },
  );
}

function authorizer(
  fetch: typeof globalThis.fetch,
  overrides: Partial<ConstructorParameters<typeof HttpRelaySubscriptionAuthorizer>[0]> = {},
): HttpRelaySubscriptionAuthorizer {
  return new HttpRelaySubscriptionAuthorizer({
    endpoint: 'https://authorizer.example/v1/authorize-relay-subscription',
    readinessEndpoint: 'https://authorizer.example/readyz',
    bearerToken: 'S'.repeat(32),
    timeoutMilliseconds: 1_000,
    fetch,
    now: () => testNow,
    requestId: () => requestId,
    ...overrides,
  });
}

describe('HTTP relay subscription authorizer', () => {
  it('sends a nonce-bound opaque-topic request with canonical deduplicated kinds', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe('https://authorizer.example/v1/authorize-relay-subscription');
      expect(init).toMatchObject({
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const headers = new Headers(init?.headers);
      expect(headers.get('accept')).toBe('application/json');
      expect(headers.get('content-type')).toBe('application/json');
      expect(headers.get('authorization')).toBe(`Bearer ${'S'.repeat(32)}`);
      expect(JSON.parse(String(init?.body))).toEqual({
        version: 'wetdrool-relay-subscription-authorization-v1',
        requestId,
        identityId: alice.identityId,
        topic: publicTopic,
        kinds: ['new-post', 'typing'],
        requestedAt: testNow.toISOString(),
      });
      return authorizationResponse();
    });

    await expect(authorizer(fetch).authorize(authorizationInput)).resolves.toEqual({
      authorized: true,
      expiresAt: testNow.getTime() + 10_000,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ['wrong nonce', { requestId: '22222222-2222-4222-8222-222222222222' }],
    ['non-final decision', { finalized: false }],
    ['wrong network', { networkId: alternateNetworkId }],
    ['negative checkpoint', { checkpointSlot: '-1' }],
    ['non-canonical checkpoint', { checkpointSlot: '01' }],
    ['overflow checkpoint', { checkpointSlot: '18446744073709551616' }],
    ['numeric checkpoint', { checkpointSlot: 42 }],
    ['stale evaluation', { evaluatedAt: new Date(testNow.getTime() - 30_001).toISOString() }],
    ['future evaluation', { evaluatedAt: new Date(testNow.getTime() + 5_001).toISOString() }],
    ['expired decision', { expiresAt: new Date(testNow.getTime() - 1).toISOString() }],
    ['long-lived decision', { expiresAt: new Date(testNow.getTime() + 15_001).toISOString() }],
    [
      'lifetime measured from a stale evaluation',
      {
        evaluatedAt: new Date(testNow.getTime() - 30_000).toISOString(),
        expiresAt: new Date(testNow.getTime() + 1).toISOString(),
      },
    ],
    [
      'expiry before evaluation',
      {
        evaluatedAt: new Date(testNow.getTime() + 5_000).toISOString(),
        expiresAt: new Date(testNow.getTime() + 4_999).toISOString(),
      },
    ],
    ['negative decision', { authorized: false }],
    ['wrong contract version', { version: 'wetdrool-relay-subscription-authorization-v2' }],
    ['unexpected response field', { unexpected: true }],
  ])('fails closed for %s', async (_label, overrides) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => authorizationResponse(overrides));
    await expect(authorizer(fetch).authorize(authorizationInput)).resolves.toBe(false);
  });

  it('fails closed before I/O for malformed relay authorization input', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const authorize = authorizer(fetch).authorize;
    await expect(authorize({ ...authorizationInput, identityId: 'not-an-identity' })).resolves.toBe(
      false,
    );
    await expect(authorize({ ...authorizationInput, topic: 'community-name' })).resolves.toBe(
      false,
    );
    await expect(authorize({ ...authorizationInput, kinds: [] })).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed on malformed, oversized, redirected, error, and unavailable responses', async () => {
    const redirected = authorizationResponse();
    Object.defineProperty(redirected, 'redirected', { value: true });
    const inputs = [
      vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response('{', {
            headers: { 'content-type': 'application/json' },
          }),
      ),
      vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response('x'.repeat(4_097), {
            headers: { 'content-type': 'application/json' },
          }),
      ),
      vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            headers: { 'content-type': 'text/plain' },
          }),
      ),
      vi.fn<typeof globalThis.fetch>(async () => authorizationResponse({}, { status: 503 })),
      vi.fn<typeof globalThis.fetch>(async () => redirected),
      vi.fn<typeof globalThis.fetch>(async () => {
        throw new Error('private upstream detail');
      }),
    ];

    for (const fetch of inputs) {
      await expect(authorizer(fetch).authorize(authorizationInput)).resolves.toBe(false);
    }
  });

  it('fails closed when the complete request exceeds its deadline', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason);
          });
        }),
    );

    const decision = authorizer(fetch, { timeoutMilliseconds: 100 }).authorize(authorizationInput);
    await vi.advanceTimersByTimeAsync(101);
    await expect(decision).resolves.toBe(false);
  });

  it('checks its bounded dependency readiness endpoint', async () => {
    const readyFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ ok: true, detail: 'redacted' }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(authorizer(readyFetch).readinessCheck()).resolves.toBeUndefined();

    const unavailable = [
      vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(JSON.stringify({ ok: false }), {
            headers: { 'content-type': 'application/json' },
          }),
      ),
      vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
      ),
      vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    ];
    for (const fetch of unavailable) {
      await expect(authorizer(fetch).readinessCheck()).rejects.toThrow(
        /subscription authorizer is not ready/u,
      );
    }
  });

  it('rejects unsafe endpoints and out-of-bounds transport settings at construction', () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const endpoint of [
      'ftp://authorizer.example/authorize',
      'https://user:secret@authorizer.example/authorize',
      'https://authorizer.example/authorize#decision',
    ]) {
      expect(() => authorizer(fetch, { endpoint })).toThrow(/credential-free HTTP\(S\)/u);
    }
    expect(() => authorizer(fetch, { bearerToken: 'short' })).toThrow(/32 to 512/u);
    expect(() => authorizer(fetch, { bearerToken: 'S'.repeat(513) })).toThrow(/32 to 512/u);
    expect(() => authorizer(fetch, { timeoutMilliseconds: 99 })).toThrow(/100 to 10000/u);
    expect(() => authorizer(fetch, { timeoutMilliseconds: 10_001 })).toThrow(/100 to 10000/u);
  });
});
