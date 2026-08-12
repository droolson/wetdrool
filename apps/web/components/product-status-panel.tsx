'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import type {
  HealthApiResponse,
  ProductClientResult,
  ProductStatusApiResponse,
} from '@/lib/product-client';

/**
 * Client readiness strip for /status.
 * Configuration is not uptime — never invents SLA or revenue.
 */
export function ProductStatusPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthApiResponse | null>(null);
  const [status, setStatus] = useState<ProductStatusApiResponse | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchHealth, fetchProductStatus } = await import('@/lib/product-client');
      const [h, s]: [
        ProductClientResult<HealthApiResponse>,
        ProductClientResult<ProductStatusApiResponse>,
      ] = await Promise.all([fetchHealth(), fetchProductStatus()]);
      if (h.kind !== 'ok' && s.kind !== 'ok') {
        setError(h.kind === 'error' ? h.message : s.kind === 'error' ? s.message : 'Status failed');
        setHealth(null);
        setStatus(null);
        return;
      }
      setHealth(h.kind === 'ok' ? h.data : null);
      setStatus(s.kind === 'ok' ? s.data : null);
      if (h.kind !== 'ok') setError(h.message);
      else if (s.kind !== 'ok') setError(s.message);
    } catch {
      setError('Network error loading product readiness.');
      setHealth(null);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const surfaces = health?.surfaces?.length ?? status?.surfaces?.length ?? 0;
  const marketSafe = status?.stores?.marketplace?.multiReplicaSafe;
  const roomsSafe = status?.stores?.rooms?.multiReplicaSafe;
  const authConfigured = status?.auth?.configured ?? health?.auth?.configured;
  const personalization =
    health?.discovery?.feedService?.personalizationActive ??
    health?.honest?.feedPersonalizationActive ??
    false;
  const revenueReady = status?.revenueReady ?? health?.revenueReady ?? false;

  return (
    <section className="card-panel" aria-labelledby="product-readiness-heading" aria-busy={loading}>
      <div className="rooms-index__heading-row">
        <h2 id="product-readiness-heading">Product API readiness</h2>
        <button type="button" disabled={loading} onClick={() => setAttempt((n) => n + 1)}>
          {loading ? 'Checking…' : 'Retry'}
        </button>
      </div>
      <p className="field-help">
        Local configuration flags from <code>/api/v1/health</code> and <code>/api/v1/status</code>.
        This is not an uptime monitor and does not ping external providers.
      </p>
      {error ? (
        <p className="field-help" role="alert">
          {error}
        </p>
      ) : null}
      <div className="rooms-index__meta" aria-live="polite">
        <StatusBadge tone="neutral">surfaces: {surfaces}</StatusBadge>
        <StatusBadge tone="pending">
          market multiReplicaSafe: {String(Boolean(marketSafe))}
        </StatusBadge>
        <StatusBadge tone="pending">
          rooms multiReplicaSafe: {String(Boolean(roomsSafe))}
        </StatusBadge>
        <StatusBadge tone={authConfigured ? 'pending' : 'neutral'}>
          auth configured: {String(Boolean(authConfigured))}
        </StatusBadge>
        <StatusBadge tone="degraded">
          personalizationActive: {String(Boolean(personalization))}
        </StatusBadge>
        <StatusBadge tone="degraded">revenueReady: {String(Boolean(revenueReady))}</StatusBadge>
      </div>
      {status?.stores?.marketplace?.kind ? (
        <p className="field-help">
          Marketplace store: <code>{status.stores.marketplace.kind}</code>
          {typeof status.stores.marketplace.listings === 'number'
            ? ` · ${status.stores.marketplace.listings} listings`
            : null}
          {' · '}
          Rooms: <code>{status.stores.rooms?.kind ?? 'unknown'}</code>
        </p>
      ) : null}
    </section>
  );
}
