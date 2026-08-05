import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deriveAuthNextStep,
  devConfigureHintText,
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

  it('derives nextStep from reachability with actionable guidance', () => {
    expect(deriveAuthNextStep('ready').nextStep).toBe('ready');
    expect(deriveAuthNextStep('ready').primaryAction).toBe('open_devices');
    expect(deriveAuthNextStep('ready').links.some((l) => l.href === '/settings/devices')).toBe(
      true,
    );
    expect(deriveAuthNextStep('ready').actionSummary.toLowerCase()).toMatch(/passkey|devices/);
    expect(deriveAuthNextStep('ready').showDevConfigureHint).toBe(false);

    expect(deriveAuthNextStep('unreachable').nextStep).toBe('start_auth_service');
    expect(deriveAuthNextStep('unreachable').primaryAction).toBe('retry_probe');
    expect(deriveAuthNextStep('unreachable').links.some((l) => l.href === '/settings/providers')).toBe(
      true,
    );

    const unreachableLoopback = deriveAuthNextStep('unreachable', { loopback: true });
    expect(unreachableLoopback.showDevConfigureHint).toBe(true);
    expect(unreachableLoopback.nextStepLabel).toMatch(/Retry probe/i);

    expect(deriveAuthNextStep('degraded').nextStep).toBe('wait_ready');
    expect(deriveAuthNextStep('degraded').primaryAction).toBe('retry_probe');
    expect(deriveAuthNextStep('degraded').actionSummary.toLowerCase()).toMatch(/retry|not ready/);
    expect(deriveAuthNextStep('degraded').showDevConfigureHint).toBe(false);

    expect(deriveAuthNextStep('invalid_origin').nextStep).toBe('configure_url');
    expect(deriveAuthNextStep('invalid_origin').primaryAction).toBe('configure_env');
    expect(deriveAuthNextStep('invalid_origin').showDevConfigureHint).toBe(true);

    expect(deriveAuthNextStep('unconfigured').nextStep).toBe('configure_url');
    expect(deriveAuthNextStep('unconfigured').links.some((l) => l.href === '/settings/devices')).toBe(
      true,
    );
  });

  it('dev configure hint is local-only and never promotes legacy RP hosts', () => {
    const hint = devConfigureHintText().toLowerCase();
    expect(hint).toMatch(/wetdrool_auth_url|next_public_auth_service_url/);
    expect(hint).toMatch(/loopback|127\.0\.0\.1|local/);
    expect(hint).not.toContain('online');
    expect(hint).toMatch(/legacy/);
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
    expect(report.actionSummary.toLowerCase()).toMatch(/ready|passkey|devices/);
    expect(report.primaryAction).toBe('open_devices');
    expect(report.links.some((l) => l.href === '/settings/devices')).toBe(true);
    expect(report.showDevConfigureHint).toBe(false);
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
    expect(report.primaryAction).toBe('retry_probe');
    expect(report.actionSummary.toLowerCase()).toMatch(/unreachable|retry|start/);
    expect(report.showDevConfigureHint).toBe(true);
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
    expect(report.nextStep).toBe('wait_ready');
    expect(report.primaryAction).toBe('retry_probe');
  });

  it('probe invalid origin attaches configure next-step fields', async () => {
    const report = await probeAuthServiceStatus({
      env: { WETDROOL_AUTH_URL: 'https://droolhouse.com' },
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(report.reachability).toBe('invalid_origin');
    expect(report.configured).toBe(false);
    expect(report.nextStep).toBe('configure_url');
    expect(report.primaryAction).toBe('configure_env');
    expect(report.showDevConfigureHint).toBe(true);
    expect(report.links.some((l) => l.href === '/settings/providers')).toBe(true);
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
