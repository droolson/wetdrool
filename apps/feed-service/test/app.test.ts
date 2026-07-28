import { describe, expect, it } from 'vitest';

import { buildFeedServiceApp, FEED_POLICY_VERSION, parseFeedServiceConfig } from '../src/index.js';
import { feedItem, rankRequest } from './fixtures.js';

describe('feed-service HTTP contract', () => {
  it('publishes liveness, readiness, OpenAPI, and the full public policy', async () => {
    const app = await buildFeedServiceApp({ logger: false });
    try {
      const [health, readiness, openapi, policy, provider] = await Promise.all([
        app.inject({ method: 'GET', url: '/healthz' }),
        app.inject({ method: 'GET', url: '/readyz' }),
        app.inject({ method: 'GET', url: '/openapi.json' }),
        app.inject({ method: 'GET', url: '/v1/policy' }),
        app.inject({ method: 'GET', url: '/v1/provider' }),
      ]);

      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({ ok: true, policyVersion: FEED_POLICY_VERSION });
      expect(readiness.statusCode).toBe(200);
      expect(openapi.json()).toMatchObject({
        openapi: '3.1.0',
        'x-socially-woke-policy': {
          canonicalAuthority: false,
          verifiesProjectionSignatures: false,
          infersSensitiveTraits: false,
          infersRageBaitRisk: false,
        },
      });
      expect(policy.json()).toMatchObject({
        canonical: false,
        policyVersion: FEED_POLICY_VERSION,
        policy: { positive: { freshnessHalfLifeHours: 36 } },
      });
      expect(policy.headers['cache-control']).toBe('no-store');
      expect(policy.headers['content-security-policy']).toContain("default-src 'none'");
      expect(provider.statusCode).toBe(200);
      expect(provider.json()).toMatchObject({
        protocol: 'socially-woke-feed-provider',
        protocolVersion: 1,
        canonical: false,
        assurance: { clientMustReapplySafetyControls: true },
      });
    } finally {
      await app.close();
    }
  });

  it('returns 503 when an injected readiness dependency fails', async () => {
    const app = await buildFeedServiceApp({
      logger: false,
      readinessCheck: () => Promise.reject(new Error('dependency unavailable')),
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/readyz' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ ok: false, policyVersion: FEED_POLICY_VERSION });
    } finally {
      await app.close();
    }
  });

  it('ranks a valid request while disclaiming authority and authenticity', async () => {
    const app = await buildFeedServiceApp({ logger: false });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/rank',
        payload: rankRequest({ items: [feedItem('one')] }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        canonical: false,
        assurance: {
          projectionSignatures: 'not-verified',
          contentAuthenticity: 'not-verified',
        },
        page: { returned: 1, eligible: 1 },
        items: [
          {
            item: { id: 'one' },
            score: { policyVersion: FEED_POLICY_VERSION },
            assurance: {
              signedProjection: 'proxied-not-verified',
              contentAuthenticity: 'not-verified',
            },
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('rejects unknown fields, duplicate IDs, and invalid risk values with issue paths', async () => {
    const app = await buildFeedServiceApp({ logger: false });
    try {
      const valid = rankRequest({
        items: [feedItem('duplicate'), feedItem('other')],
      });
      const invalid = {
        ...valid,
        items: [
          valid.items[0],
          {
            ...valid.items[1],
            id: 'duplicate',
            signals: {
              ...valid.items[1]?.signals,
              rageBaitRisk: 1.1,
            },
          },
        ],
        hiddenAuthority: true,
      };
      const response = await app.inject({
        method: 'POST',
        url: '/v1/rank',
        payload: invalid,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        canonical: false,
        error: {
          code: 'invalid-request',
          issues: expect.arrayContaining([
            expect.objectContaining({ path: 'items.1.signals.rageBaitRisk' }),
            expect.objectContaining({ path: '' }),
          ]),
        },
      });

      const duplicateResponse = await app.inject({
        method: 'POST',
        url: '/v1/rank',
        payload: {
          ...valid,
          items: [valid.items[0], { ...valid.items[1], id: 'duplicate' }],
        },
      });
      expect(duplicateResponse.statusCode).toBe(400);
      expect(duplicateResponse.json()).toMatchObject({
        error: {
          issues: expect.arrayContaining([expect.objectContaining({ path: 'items.1.id' })]),
        },
      });
    } finally {
      await app.close();
    }
  });

  it('maps malformed JSON and oversized bodies to bounded safe errors', async () => {
    const app = await buildFeedServiceApp({ logger: false });
    try {
      const malformed = await app.inject({
        method: 'POST',
        url: '/v1/rank',
        headers: { 'content-type': 'application/json' },
        payload: '{"items":',
      });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toMatchObject({ error: { code: 'invalid-json' } });

      const oversized = await app.inject({
        method: 'POST',
        url: '/v1/rank',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ padding: 'x'.repeat(524_288) }),
      });
      expect(oversized.statusCode).toBe(413);
      expect(oversized.json()).toMatchObject({ error: { code: 'body-too-large' } });
    } finally {
      await app.close();
    }
  });

  it('enforces a configurable per-client request rate limit', async () => {
    const app = await buildFeedServiceApp({ logger: false, rateLimitMax: 2 });
    try {
      const payload = rankRequest({ items: [feedItem('limited')] });
      const first = await app.inject({ method: 'POST', url: '/v1/rank', payload });
      const second = await app.inject({ method: 'POST', url: '/v1/rank', payload });
      const third = await app.inject({ method: 'POST', url: '/v1/rank', payload });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(third.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});

describe('feed-service origin configuration', () => {
  it('normalizes exact origins and rejects the redirect-only legacy host', () => {
    expect(
      parseFeedServiceConfig({
        FEED_SERVICE_CORS_ORIGINS: 'https://woke.social:443/, http://localhost:3000',
      }).allowedOrigins,
    ).toEqual(['https://woke.social', 'http://localhost:3000']);
    expect(() =>
      parseFeedServiceConfig({
        FEED_SERVICE_CORS_ORIGINS: 'https://sociallywoke.com',
      }),
    ).toThrow(/legacy redirect host/);
  });
});
