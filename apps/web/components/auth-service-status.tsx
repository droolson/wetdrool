'use client';

import { useCallback, useEffect, useState } from 'react';
import { ButtonLink, StatusBadge } from '@wetdrool/ui';

import {
  reachabilityDetail,
  reachabilityLabel,
  type AuthServiceStatusReport,
} from '@/lib/auth/auth-service-config';

function toneFor(
  reachability: AuthServiceStatusReport['reachability'],
): 'verified' | 'pending' | 'degraded' | 'neutral' {
  if (reachability === 'ready') return 'verified';
  if (reachability === 'degraded') return 'pending';
  if (reachability === 'unconfigured') return 'neutral';
  return 'degraded';
}

function probeWord(value: boolean | null): string {
  if (value === null) return 'no response';
  return value ? 'ok' : 'fail';
}

function formatCheckedAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function AuthServiceStatus({ compact = false }: { readonly compact?: boolean }) {
  const [report, setReport] = useState<AuthServiceStatusReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

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
        setError(
          res.status === 0
            ? 'Network error probing auth status.'
            : `Status probe failed (${res.status}). This page will not invent an “online” state.`,
        );
        setReport(null);
        return;
      }
      setReport(body as AuthServiceStatusReport);
    } catch {
      setError('Network error probing auth status. Retry when the product API is reachable.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  if (loading && !report) {
    return (
      <div className="auth-service-status" role="status" aria-busy="true">
        <p className="field-help">Checking authentication service readiness…</p>
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="auth-service-status" role="alert">
        <p className="field-help">
          {error}{' '}
          <button
            type="button"
            className="auth-service-status__retry"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry probe
          </button>
        </p>
        {!compact ? (
          <div className="auth-service-status__links">
            <ButtonLink href="/settings/providers" variant="quiet">
              Provider settings
            </ButtonLink>
            <ButtonLink href="/settings/devices" variant="quiet">
              Passkeys &amp; devices
            </ButtonLink>
          </div>
        ) : null}
      </div>
    );
  }

  if (!report) return null;

  const ceremoniesOk = report.reachability === 'ready';
  const showActions = !ceremoniesOk || !compact;

  return (
    <div className="auth-service-status" role="status" aria-live="polite" aria-busy={loading}>
      <div className="auth-service-status__row">
        <StatusBadge tone={toneFor(report.reachability)}>
          {reachabilityLabel(report.reachability)}
        </StatusBadge>
        {!compact ? (
          <span className="field-help">
            {report.origin ?? 'no origin'} · healthz {probeWord(report.healthz)} · readyz{' '}
            {probeWord(report.readyz)}
          </span>
        ) : (
          <span className="field-help">{reachabilityDetail(report)}</span>
        )}
        <button
          type="button"
          className="auth-service-status__retry"
          onClick={() => setAttempt((n) => n + 1)}
          disabled={loading}
        >
          {loading ? 'Probing…' : 'Retry probe'}
        </button>
      </div>

      <p className="field-help">{report.note}</p>

      {!compact ? (
        <>
          <p className="field-help">{reachabilityDetail(report)}</p>
          <p className="field-help">
            Checked at <time dateTime={report.checkedAt}>{formatCheckedAt(report.checkedAt)}</time>
            {' · '}
            Protocol identity established: <strong>false</strong>
            {' · '}
            WebAuthn origin mode: <strong>{report.webAuthnOrigin}</strong>
            {report.source ? (
              <>
                {' · '}
                config <code>{report.source}</code>
              </>
            ) : null}
          </p>
        </>
      ) : null}

      {showActions ? (
        <div className="auth-service-status__links">
          {report.reachability === 'ready' ? (
            <>
              <ButtonLink href="/signin" variant="quiet">
                Sign in
              </ButtonLink>
              <ButtonLink href="/onboarding" variant="quiet">
                Create passkey account
              </ButtonLink>
              <ButtonLink href="/settings/devices" variant="quiet">
                Manage passkeys
              </ButtonLink>
            </>
          ) : (
            <>
              <ButtonLink href="/settings/providers" variant="secondary">
                Review connection readiness
              </ButtonLink>
              <ButtonLink href="/settings/devices" variant="quiet">
                Passkeys &amp; devices
              </ButtonLink>
              <ButtonLink href="/onboarding" variant="quiet">
                Onboarding
              </ButtonLink>
            </>
          )}
        </div>
      ) : null}

      {!ceremoniesOk && !compact ? (
        <p className="field-help" role="note">
          Passkey create/sign-in buttons on other pages remain available for local debugging, but
          this probe does <strong>not</strong> claim the authentication service is online until
          reachability is <strong>ready</strong>.
        </p>
      ) : null}
    </div>
  );
}
