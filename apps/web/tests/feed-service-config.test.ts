import { describe, expect, it } from 'vitest';

import {
  probeFeedServiceConfig,
  resolveFeedServiceConfig,
  shouldProbeFeedService,
} from '../lib/feed-service-config';
import {
  personalizationStatus,
  personalizationStatusFromProbe,
} from '../lib/short-feed';

describe('resolveFeedServiceConfig', () => {
  it('is unconfigured when URL missing or empty', () => {
    expect(resolveFeedServiceConfig({}).configured).toBe(false);
    expect(resolveFeedServiceConfig({}).origin).toBeNull();
    expect(resolveFeedServiceConfig({}).wiring).toBe('unconfigured');
    expect(
      resolveFeedServiceConfig({ NEXT_PUBLIC_FEED_SERVICE_URL: '' }).configured,
    ).toBe(false);
    expect(
      resolveFeedServiceConfig({ NEXT_PUBLIC_FEED_SERVICE_URL: '   ' }).configured,
    ).toBe(false);
  });

  it('rejects invalid URLs and non-http protocols', () => {
    expect(
      resolveFeedServiceConfig({ NEXT_PUBLIC_FEED_SERVICE_URL: 'not-a-url' }).wiring,
    ).toBe('invalid');
    expect(
      resolveFeedServiceConfig({ NEXT_PUBLIC_FEED_SERVICE_URL: 'ftp://localhost:4100' })
        .configured,
    ).toBe(false);
    expect(
      resolveFeedServiceConfig({ NEXT_PUBLIC_FEED_SERVICE_URL: 'ftp://localhost:4100' })
        .origin,
    ).toBeNull();
  });

  it('exposes origin only (strips path/query)', () => {
    const cfg = resolveFeedServiceConfig({
      NEXT_PUBLIC_FEED_SERVICE_URL: 'http://localhost:4100/v1/rank?secret=x',
    });
    expect(cfg.configured).toBe(true);
    expect(cfg.origin).toBe('http://localhost:4100');
    expect(cfg.loopback).toBe(true);
    expect(cfg.source).toBe('NEXT_PUBLIC_FEED_SERVICE_URL');
    expect(cfg.wiring).toBe('configured-unwired');
  });

  it('marks remote https as configured-unwired loopback false', () => {
    const cfg = resolveFeedServiceConfig({
      NEXT_PUBLIC_FEED_SERVICE_URL: 'https://feed.wetdrool.com',
    });
    expect(cfg.configured).toBe(true);
    expect(cfg.origin).toBe('https://feed.wetdrool.com');
    expect(cfg.loopback).toBe(false);
  });
});

describe('shouldProbeFeedService', () => {
  it('probes loopback only by default', () => {
    const loop = resolveFeedServiceConfig({
      NEXT_PUBLIC_FEED_SERVICE_URL: 'http://127.0.0.1:4100',
    });
    expect(shouldProbeFeedService(loop)).toBe(true);

    const remote = resolveFeedServiceConfig({
      NEXT_PUBLIC_FEED_SERVICE_URL: 'https://feed.wetdrool.com',
    });
    expect(shouldProbeFeedService(remote)).toBe(false);
    expect(shouldProbeFeedService(remote, { explicit: true })).toBe(true);
    expect(
      shouldProbeFeedService(remote, {
        env: { WETDROOL_FEED_SERVICE_PROBE: '1' },
      }),
    ).toBe(true);
  });
});

describe('probeFeedServiceConfig', () => {
  it('does not network when unconfigured', async () => {
    let calls = 0;
    const report = await probeFeedServiceConfig({
      env: {},
      fetchImpl: (async () => {
        calls += 1;
        throw new Error('should not fetch');
      }) as typeof fetch,
    });
    expect(calls).toBe(0);
    expect(report.configured).toBe(false);
    expect(report.personalizationActive).toBe(false);
    expect(report.healthz).toBeNull();
    expect(report.rankingSource).toBe('local-droolrank-lite');
  });

  it('skips network for non-loopback without explicit allow', async () => {
    let calls = 0;
    const report = await probeFeedServiceConfig({
      env: { NEXT_PUBLIC_FEED_SERVICE_URL: 'https://feed.wetdrool.com' },
      fetchImpl: (async () => {
        calls += 1;
        throw new Error('should not fetch');
      }) as typeof fetch,
    });
    expect(calls).toBe(0);
    expect(report.configured).toBe(true);
    expect(report.origin).toBe('https://feed.wetdrool.com');
    expect(report.wiring).toBe('configured-unwired');
    expect(report.healthz).toBeNull();
    expect(report.personalizationActive).toBe(false);
  });

  it('probes healthz on loopback and stays personalization-inactive', async () => {
    const report = await probeFeedServiceConfig({
      env: { NEXT_PUBLIC_FEED_SERVICE_URL: 'http://localhost:4100' },
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url).toBe('http://localhost:4100/healthz');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch,
    });
    expect(report.wiring).toBe('reachable');
    expect(report.healthz).toBe(true);
    expect(report.personalizationActive).toBe(false);
    expect(report.rankingSource).toBe('local-droolrank-lite');
  });

  it('reports unreachable when fetch fails on loopback', async () => {
    const report = await probeFeedServiceConfig({
      env: { NEXT_PUBLIC_FEED_SERVICE_URL: 'http://localhost:4100' },
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch,
    });
    expect(report.wiring).toBe('unreachable');
    expect(report.healthz).toBeNull();
    expect(report.personalizationActive).toBe(false);
  });

  it('reports degraded when healthz returns not ok', async () => {
    const report = await probeFeedServiceConfig({
      env: { NEXT_PUBLIC_FEED_SERVICE_URL: 'http://127.0.0.1:4100' },
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: false }), { status: 503 })) as typeof fetch,
    });
    expect(report.wiring).toBe('degraded');
    expect(report.healthz).toBe(false);
    expect(report.personalizationActive).toBe(false);
  });
});

describe('personalizationStatus honesty', () => {
  it('stays unconfigured without URL', () => {
    const status = personalizationStatus({});
    expect(status.configured).toBe(false);
    expect(status.mode).toBe('unconfigured');
    expect(status.personalizationActive).toBe(false);
    expect(status.origin).toBeNull();
    expect(status.note).toMatch(/for-you/i);
  });

  it('shows origin when configured but never activates personalization', () => {
    const status = personalizationStatus({
      NEXT_PUBLIC_FEED_SERVICE_URL: 'http://localhost:4100/secret-path',
    });
    expect(status.configured).toBe(true);
    expect(status.origin).toBe('http://localhost:4100');
    expect(status.personalizationActive).toBe(false);
    expect(status.mode).toBe('configured-unwired');
    expect(status.rankingSource).toBe('local-droolrank-lite');
  });

  it('maps probe reports without inventing for-you', () => {
    const mapped = personalizationStatusFromProbe({
      configured: true,
      origin: 'http://localhost:4100',
      wiring: 'reachable',
      healthz: true,
      note: 'ok',
    });
    expect(mapped.personalizationActive).toBe(false);
    expect(mapped.origin).toBe('http://localhost:4100');
    expect(mapped.healthz).toBe(true);
  });
});
