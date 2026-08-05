'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import type { AuthServiceStatusReport } from '@/lib/auth/auth-service-config';

function toneFor(reachability: AuthServiceStatusReport['reachability']): 'verified' | 'pending' | 'degraded' {
  if (reachability === 'ready') return 'verified';
  if (reachability === 'degraded') return 'pending';
  return 'degraded';
}

export function AuthServiceStatus({ compact = false }: { readonly compact?: boolean }) {
  const [report, setReport] = useState<AuthServiceStatusReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/status', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || !body || typeof body !== 'object' || !('reachability' in body)) {
        setError(`Status probe failed (${res.status}).`);
        setReport(null);
        return;
      }
      setReport(body as AuthServiceStatusReport);
    } catch {
      setError('Network error probing auth status.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !report) {
    return (
      <p className="field-help" role="status">
        Checking authentication service…
      </p>
    );
  }

  if (error && !report) {
    return (
      <p className="field-help" role="alert">
        {error}{' '}
        <button type="button" onClick={() => void load()}>
          Retry
        </button>
      </p>
    );
  }

  if (!report) return null;

  return (
    <div className="auth-service-status" role="status" aria-live="polite">
      <div className="auth-service-status__row">
        <StatusBadge tone={toneFor(report.reachability)}>{report.reachability}</StatusBadge>
        {!compact ? (
          <span className="field-help">
            {report.origin ?? 'no origin'} · healthz{' '}
            {report.healthz === null ? '?' : report.healthz ? 'ok' : 'fail'} · readyz{' '}
            {report.readyz === null ? '?' : report.readyz ? 'ok' : 'fail'}
          </span>
        ) : null}
        <button type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>
      <p className="field-help">{report.note}</p>
      {!compact ? (
        <p className="field-help">
          Protocol identity established: <strong>false</strong> · WebAuthn origin mode:{' '}
          <strong>{report.webAuthnOrigin}</strong>
          {report.source ? (
            <>
              {' '}
              · config <code>{report.source}</code>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
