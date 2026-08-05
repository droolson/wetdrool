'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import type { AgeAccessDecision } from '@/lib/age-access-policy';
import { ageAccessPolicySnapshot } from '@/lib/age-access-policy';
import {
  readRegionHint,
  writeRegionHint,
} from '@/lib/nsfw-mode';

export function AgeAccessPolicyPanel() {
  const [policy, setPolicy] = useState<AgeAccessDecision>(() => ageAccessPolicySnapshot(null));
  const [region, setRegion] = useState('');
  const [source, setSource] = useState<'api' | 'local'>('local');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async (regionHint: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const { fetchAgePolicy } = await import('@/lib/product-client');
      const result = await fetchAgePolicy(regionHint);
      if (result.kind === 'ok' && result.data.policy) {
        setPolicy(result.data.policy);
        setNote(result.data.note ?? null);
        setSource('api');
      } else {
        setPolicy(ageAccessPolicySnapshot(regionHint));
        setSource('local');
        setError(result.kind === 'error' ? result.message : 'Policy API unavailable.');
      }
    } catch {
      setPolicy(ageAccessPolicySnapshot(regionHint));
      setSource('local');
      setError('Network error loading age policy.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? readRegionHint(window.localStorage) : null;
    setRegion(stored ?? '');
    void load(stored);
  }, [load]);

  const applyRegion = () => {
    const raw = region.trim() === '' ? null : region.trim();
    const written = writeRegionHint(window.localStorage, raw);
    setRegion(written.regionHint ?? '');
    setStatus(
      written.regionHint
        ? `Region hint saved locally: ${written.regionHint}`
        : 'Region hint cleared (local only).',
    );
    void load(written.regionHint);
  };

  return (
    <section className="product-card" aria-labelledby="age-access-policy-title">
      <div className="section-heading">
        <p className="section-kicker">Age access policy</p>
        <h2 id="age-access-policy-title">18+ · self-attest by default</h2>
        <StatusBadge tone={source === 'api' ? 'pending' : 'degraded'}>
          {loading ? 'loading' : source === 'api' ? 'api policy' : 'local snapshot'}
        </StatusBadge>
      </div>
      <p>
        Adult surfaces use a <strong>local self-attestation</strong> gate (minimum age{' '}
        {policy.minimumAge}). WetDrool does not collect government ID images or numbers by default.
        A wallet signature is never age proof.
      </p>

      <div className="age-policy-region">
        <label htmlFor="age-region-hint">
          Optional region hint (ISO-ish, local only)
          <input
            id="age-region-hint"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="e.g. CH, XX"
            maxLength={8}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <button type="button" onClick={applyRegion}>
          Apply region
        </button>
      </div>
      <p className="field-help">
        Hint is stored in this browser and sent only to <code>/api/v1/policy/age</code> for
        configuration — not a geo-block engine and not legal advice.
      </p>

      {loading ? (
        <p className="field-help" role="status">
          Loading policy…
        </p>
      ) : null}
      {error ? (
        <p className="field-help" role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load(readRegionHint(window.localStorage))}>
            Retry
          </button>
        </p>
      ) : null}
      {note ? <p className="field-help">{note}</p> : null}
      {status ? (
        <p className="field-help" role="status">
          {status}
        </p>
      ) : null}

      <dl className="e2ee-status__grid">
        <div>
          <dt>Outcome</dt>
          <dd>
            <StatusBadge tone="neutral">{policy.outcome}</StatusBadge>
          </dd>
        </div>
        <div>
          <dt>Default proof</dt>
          <dd>
            <code className="inline-identifier">{policy.defaultProof}</code>
          </dd>
        </div>
        <div>
          <dt>Collect government ID</dt>
          <dd>
            <strong>{String(policy.collectGovernmentId)}</strong>
          </dd>
        </div>
        <div>
          <dt>Wallet is age proof</dt>
          <dd>
            <strong>{String(policy.walletIsAgeProof)}</strong>
          </dd>
        </div>
        <div>
          <dt>Region hint</dt>
          <dd>{policy.regionHint ?? '—'}</dd>
        </div>
        <div>
          <dt>Operator vehicle</dt>
          <dd>{policy.operator.label}</dd>
        </div>
        <div>
          <dt>Policy version</dt>
          <dd>{policy.version}</dd>
        </div>
      </dl>
      <ul className="e2ee-status__details">
        {policy.reasons.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="muted-copy">{policy.operator.detail}</p>
      <p className="field-help">
        Machine JSON: <a href="/api/v1/policy/age">/api/v1/policy/age</a>
      </p>
    </section>
  );
}
