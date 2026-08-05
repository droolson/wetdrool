'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

export function VanityRegistryStatus() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registryLive, setRegistryLive] = useState(false);
  const [claimExecutable, setClaimExecutable] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [monthlyUsd, setMonthlyUsd] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchVanityStatus } = await import('@/lib/product-client');
      const result = await fetchVanityStatus();
      if (result.kind !== 'ok') {
        setError(result.message);
        return;
      }
      setRegistryLive(result.data.registryLive === true);
      setClaimExecutable(result.data.claimExecutable === true);
      setNote(result.data.note ?? null);
      setMonthlyUsd(
        typeof result.data.monthlyUsd === 'number' ? result.data.monthlyUsd : null,
      );
    } catch {
      setError('Network error loading vanity registry status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="card-panel" aria-labelledby="vanity-api-heading" aria-busy={loading}>
      <div className="rooms-index__heading-row">
        <h2 id="vanity-api-heading">Registry status (product API)</h2>
        <button type="button" disabled={loading} onClick={() => void load()}>
          {loading ? 'Checking…' : 'Retry'}
        </button>
      </div>
      <div className="rooms-index__meta" aria-live="polite">
        <StatusBadge tone="degraded">registryLive: {String(registryLive)}</StatusBadge>
        <StatusBadge tone="pending">claimExecutable: {String(claimExecutable)}</StatusBadge>
        <StatusBadge tone="pending">settlementLive: false</StatusBadge>
        {monthlyUsd !== null ? (
          <StatusBadge tone="neutral">quote ${monthlyUsd.toFixed(2)}/mo</StatusBadge>
        ) : null}
      </div>
      {error ? (
        <p className="field-help" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="field-help">{note}</p> : null}
      <p className="field-help">
        Owned names listed: 0 (none invented). API: <code>/api/v1/vanity</code>
      </p>
    </section>
  );
}
