import { describe, expect, it, vi } from 'vitest';

import { HttpRelayKeyAuthorizer } from '../src/http-key-authorizer.js';
import { alice, testNow } from './fixtures.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const networkId = alice.identityId.split(':').slice(2, -1).join(':');

function authorizationResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      version: 'wokesocial-relay-key-authorization-v1',
      requestId,
      authorized: true,
      finalized: true,
      networkId,
      checkpointSlot: '42',
      evaluatedAt: testNow.toISOString(),
      expiresAt: new Date(testNow.getTime() + 10_000).toISOString(),
      ...overrides,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

function authorizer(fetch: typeof globalThis.fetch) {
  return new HttpRelayKeyAuthorizer({
    endpoint: 'https://authorizer.example/v1/authorize-relay-key',
    readinessEndpoint: 'https://authorizer.example/readyz',
    bearerToken: 'A'.repeat(32),
    timeoutMilliseconds: 1_000,
    fetch,
    now: () => testNow,
    requestId: () => requestId,
  });
}

describe('HTTP relay key authorizer', () => {
  it('accepts a nonce-bound, finalized, network-bound short-lived decision', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${'A'.repeat(32)}`);
      expect(JSON.parse(String(init?.body))).toMatchObject({
        requestId,
        identityId: alice.identityId,
        keyId: alice.keyId,
        purpose: 'new-post',
      });
      return authorizationResponse();
    });

    await expect(
      authorizer(fetch).authorize({
        identityId: alice.identityId,
        keyId: alice.keyId,
        purpose: 'new-post',
        issuedAt: testNow.toISOString(),
      }),
    ).resolves.toBe(true);
  });

  it.each([
    { requestId: '22222222-2222-4222-8222-222222222222' },
    { finalized: false },
    { networkId: networkId.replace('wokenet:v1:', 'wokenet:v1:1') },
    { evaluatedAt: new Date(testNow.getTime() - 31_000).toISOString() },
    { expiresAt: new Date(testNow.getTime() + 16_000).toISOString() },
    {
      evaluatedAt: new Date(testNow.getTime() - 30_000).toISOString(),
      expiresAt: new Date(testNow.getTime() + 1).toISOString(),
    },
    { expiresAt: testNow.toISOString() },
    {
      evaluatedAt: new Date(testNow.getTime() + 5_000).toISOString(),
      expiresAt: new Date(testNow.getTime() + 4_000).toISOString(),
    },
    { authorized: false },
  ])('fails closed for an invalid or negative decision %#', async (overrides) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => authorizationResponse(overrides));
    await expect(
      authorizer(fetch).authorize({
        identityId: alice.identityId,
        keyId: alice.keyId,
        purpose: 'subscribe',
        issuedAt: testNow.toISOString(),
      }),
    ).resolves.toBe(false);
  });

  it('fails closed on malformed, oversized, error, and unavailable responses', async () => {
    const inputs = [
      vi.fn<typeof globalThis.fetch>(async () => new Response('{', { status: 200 })),
      vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response('x'.repeat(4_097), {
            headers: { 'content-type': 'application/json' },
          }),
      ),
      vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { status: 503 })),
      vi.fn<typeof globalThis.fetch>(async () => {
        throw new Error('private upstream detail');
      }),
    ];
    for (const fetch of inputs) {
      await expect(
        authorizer(fetch).authorize({
          identityId: alice.identityId,
          keyId: alice.keyId,
          purpose: 'presence',
          issuedAt: testNow.toISOString(),
        }),
      ).resolves.toBe(false);
    }
  });

  it('checks the configured dependency readiness endpoint', async () => {
    const readyFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ ok: true, detail: 'redacted' }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(authorizer(readyFetch).readinessCheck()).resolves.toBeUndefined();

    const unavailableFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ ok: false }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(authorizer(unavailableFetch).readinessCheck()).rejects.toThrow(/not ready/u);
  });
});
