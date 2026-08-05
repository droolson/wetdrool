'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import type { MeshStatusApiResponse, ProductClientResult } from '@/lib/product-client';

/**
 * Client panel for GET /api/v1/mesh.
 * Never invents live peers, production mesh, or multi-replica safety.
 */
export function MeshStatusPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<MeshStatusApiResponse | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchMeshStatus } = await import('@/lib/product-client');
      const result: ProductClientResult<MeshStatusApiResponse> = await fetchMeshStatus();
      if (result.kind !== 'ok') {
        setError(result.message);
        setReport(null);
        return;
      }
      setReport(result.data);
    } catch {
      setError('Network error loading mesh status.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const relayConfigured = report?.relay?.configured === true;
  const meshDeployed = report?.mesh?.productionMeshDeployed === true;

  return (
    <section className="card-panel" aria-labelledby="mesh-status-heading" aria-busy={loading}>
      <div className="rooms-index__heading-row">
        <h2 id="mesh-status-heading">Product mesh / relay probe</h2>
        <button type="button" onClick={() => setAttempt((n) => n + 1)} disabled={loading}>
          {loading ? 'Checking…' : 'Retry'}
        </button>
      </div>

      {loading && !report ? (
        <p className="field-help" role="status">
          Loading mesh status from <code>/api/v1/mesh</code>…
        </p>
      ) : null}

      {error ? (
        <p className="field-help" role="alert">
          {error}{' '}
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </p>
      ) : null}

      {report ? (
        <>
          <div className="rooms-index__meta" aria-live="polite">
            <StatusBadge tone="degraded">
              productionMeshDeployed: {String(meshDeployed)}
            </StatusBadge>
            <StatusBadge tone={relayConfigured ? 'pending' : 'neutral'}>
              relay {relayConfigured ? 'configured' : 'unconfigured'}
            </StatusBadge>
            <StatusBadge tone="pending">multiReplicaSafe: false</StatusBadge>
            <StatusBadge tone="neutral">
              livePeerCount:{' '}
              {report.relay?.livePeerCount === null || report.relay?.livePeerCount === undefined
                ? 'null (unclaimed)'
                : String(report.relay.livePeerCount)}
            </StatusBadge>
          </div>

          <ul className="field-help">
            <li>
              Foundation: <code>{report.mesh?.foundation ?? 'anyproto/any-sync'}</code>
            </li>
            <li>
              liveMeshPeersClaimed:{' '}
              {String(report.relay?.liveMeshPeersClaimed === true ? true : false)}
            </li>
            {report.relay?.displayEndpoints && report.relay.displayEndpoints.length > 0 ? (
              <li>
                Relay endpoints (display only):{' '}
                {report.relay.displayEndpoints.map((e) => (
                  <code key={e}>{e}</code>
                ))}
              </li>
            ) : (
              <li>No valid relay endpoints configured.</li>
            )}
          </ul>

          {report.relay?.note ? <p className="field-help">{report.relay.note}</p> : null}
          {report.note ? <p className="field-help">{report.note}</p> : null}
          {report.mesh?.notes?.map((n) => (
            <p key={n} className="field-help">
              {n}
            </p>
          ))}
        </>
      ) : null}

      <p className="field-help">
        Configuration is not uptime. This probe does not invent connected peers or a live mesh SLA.
      </p>
    </section>
  );
}
