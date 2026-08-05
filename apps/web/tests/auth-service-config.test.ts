import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deriveAuthNextStep,
  parseAuthServiceOrigin,
  passkeyCeremoniesAllowed,
  probeAuthServiceStatus,
  reachabilityDetail,
  reachabilityLabel,
  resolveAuthServiceConfig,
  tryResolveAuthServiceConfig,
} from '../lib/auth/auth-service-config';

describe('auth service config', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses loopback and https origins', () => {
    expect(parseAuthServiceOrigin('http://localhost:4300')).toBe('http://localhost:4300');
    expect(parseAuthServiceOrigin('https://auth.wetdrool.com/')).toBe('https://auth.wetdrool.com');
  });

  it('rejects legacy redirect hosts and http remote', () => {
    expect(() => parseAuthServiceOrigin('https://droolhouse.com')).toThrow();
    expect(() => parseAuthServiceOrigin('http://example.com')).toThrow();
  });

  it('resolves env precedence and defaults', () => {
    const cfg = resolveAuthServiceConfig({
      WETDROOL_AUTH_URL: 'http://127.0.0.1:4300',
      NEXT_PUBLIC_AUTH_SERVICE_URL: 'https://other.example',
    });
    expect(cfg.origin).toBe('http://127.0.0.1:4300');
    expect(cfg.source).toBe('WETDROOL_AUTH_URL');
    expect(cfg.loopback).toBe(true);

    const def = resolveAuthServiceConfig({});
    expect(def.origin).toBe('http://localhost:4300');
    expect(def.source).toBe('default-localhost');
  });

  it('tryResolve fails closed on invalid', () => {
    const bad = tryResolveAuthServiceConfig({ WETDROOL_AUTH_URL: 'https://droolhouse.com' });
    expect(bad.ok).toBe(false);
  });

  it('derives nextStep from reachability', () => {
    expect(deriveAuthNextStep('ready').nextStep).toBe('ready');
    expect(deriveAuthNextStep('unreachable').nextStep).toBe('start_auth_service');
    expect(deriveAuthNextStep('degraded').nextStep).toBe('wait_ready');
    expect(deriveAuthNextStep('invalid_origin').nextStep).toBe('configure_url');
  });

  it('probe reports ready when healthz and readyz succeed', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) {
        return new Response(JSON.stringify({ ok: true, service: '@wetdrool/auth-service' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, storage: 'memory' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const report = await probeAuthServiceStatus({
      env: { WETDROOL_AUTH_URL: 'http://127.0.0.1:4300' },
      fetchImpl,
      timeoutMs: 500,
    });
    expect(report.reachability).toBe('ready');
    expect(report.healthz).toBe(true);
    expect(report.readyz).toBe(true);
    expect(report.protocolIdentityEstablished).toBe(false);
    expect(report.webAuthnOrigin).toBe('local-dev');
    expect(report.nextStep).toBe('ready');
    expect(report.nextStepLabel.toLowerCase()).not.toContain('online');
  });

  it('probe reports unreachable when fetch fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const report = await probeAuthServiceStatus({
      env: { NEXT_PUBLIC_AUTH_SERVICE_URL: 'http://localhost:4300' },
      fetchImpl,
      timeoutMs: 200,
    });
    expect(report.reachability).toBe('unreachable');
    expect(report.healthz).toBe(null);
    expect(report.note).toMatch(/Cannot reach/i);
    expect(report.nextStep).toBe('start_auth_service');
  });

  it('probe reports degraded when healthz ok but readyz fails', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 503 });
    }) as unknown as typeof fetch;
    const report = await probeAuthServiceStatus({
      env: { WETDROOL_AUTH_URL: 'http://localhost:4300' },
      fetchImpl,
    });
    expect(report.reachability).toBe('degraded');
    expect(report.readyz).toBe(false);
    expect(report.note).toMatch(/Fail closed/i);
    expect(reachabilityLabel(report.reachability)).toBe('Degraded — not ready');
    expect(passkeyCeremoniesAllowed(report.reachability)).toBe(false);
    expect(reachabilityDetail(report)).toMatch(/healthz/i);
  });

  it('labels never claim online for ready reachability', () => {
    expect(reachabilityLabel('ready')).toBe('Passkey service ready');
    expect(reachabilityLabel('ready').toLowerCase()).not.toContain('online');
    expect(passkeyCeremoniesAllowed('ready')).toBe(true);
    expect(passkeyCeremoniesAllowed('unreachable')).toBe(false);
    expect(reachabilityLabel('unreachable')).toBe('Unreachable');
    expect(deriveAuthNextStep('degraded').nextStep).toBe('wait_ready');
    expect(deriveAuthNextStep('invalid_origin').nextStep).toBe('configure_url');
  });
});
