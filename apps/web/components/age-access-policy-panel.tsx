'use client';

import { useCallback, useEffect, useState } from 'react';
import { ButtonLink, StatusBadge } from '@wetdrool/ui';

import type { AgeAccessDecision, AgeAccessOutcome } from '@/lib/age-access-policy';
import { ageAccessPolicySnapshot } from '@/lib/age-access-policy';
import {
  readRegionHint,
  writeRegionHint,
} from '@/lib/nsfw-mode';

function outcomeLabel(outcome: AgeAccessOutcome): string {
  switch (outcome) {
    case 'allow_self_attest':
      return 'Self-attest allowed';
    case 'require_age_assurance':
      return 'Stronger assurance preferred';
    case 'block_adult_surface':
      return 'Adult surface blocked';
  }
}

function outcomeTone(outcome: AgeAccessOutcome): 'verified' | 'pending' | 'degraded' | 'neutral' {
  switch (outcome) {
    case 'allow_self_attest':
      return 'pending';
    case 'require_age_assurance':
      return 'degraded';
    case 'block_adult_surface':
      return 'degraded';
  }
}

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
        setError(
          result.kind === 'error'
            ? `${result.message} Showing local policy snapshot until the API answers.`
            : 'Policy API unavailable. Showing local policy snapshot — not a compliance claim.',
        );
      }
    } catch {
      setPolicy(ageAccessPolicySnapshot(regionHint));
      setSource('local');
      setError('Network error loading age policy. Local snapshot is active; retry when ready.');
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
        A wallet signature is never age proof. This panel is configuration transparency, not a live
        geo-enforcement engine.
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
        <button type="button" onClick={applyRegion} disabled={loading}>
          Apply region
        </button>
        <button
          type="button"
          onClick={() => void load(readRegionHint(window.localStorage))}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Retry policy fetch'}
        </button>
      </div>
      <p className="field-help">
        Hint is stored in this browser and sent only to <code>/api/v1/policy/age</code> for
        configuration — not a geo-block engine and not legal advice. Clearing browser storage
        removes the hint.
      </p>

      {loading ? (
        <p className="field-help" role="status">
          Loading age-access policy…
        </p>
      ) : null}
      {error ? (
        <p className="field-help" role="alert">
          {error}
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
            <StatusBadge tone={outcomeTone(policy.outcome)}>
              {outcomeLabel(policy.outcome)}
            </StatusBadge>
            <span className="field-help">
              <code className="inline-identifier">{policy.outcome}</code>
            </span>
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
        <div>
          <dt>Source</dt>
          <dd>{source === 'api' ? 'Product API' : 'Embedded local snapshot'}</dd>
        </div>
      </dl>
      <ul className="e2ee-status__details">
        {policy.reasons.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="muted-copy">{policy.operator.detail}</p>
      <div className="passkey-auth__links">
        <ButtonLink href="/settings/safety" variant="quiet">
          Safety presentation defaults
        </ButtonLink>
        <ButtonLink href="/settings/privacy" variant="quiet">
          Privacy controls
        </ButtonLink>
        <a className="field-help" href="/api/v1/policy/age">
          Machine JSON: /api/v1/policy/age
        </a>
      </div>
    </section>
  );
}
