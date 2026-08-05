'use client';

import { useCallback, useEffect, useState } from 'react';
import { ButtonLink, StatusBadge } from '@wetdrool/ui';

import {
  fetchMeshStatus,
  type MeshStatusApiResponse,
} from '@/lib/product-client';

/**
 * Client panel for GET /api/v1/mesh — configuration honesty only.
 * Never invents live peers, multi-replica safety, or production mesh deployment.
 */
export function MeshStatusPanel({
  compact = false,
}: {
  readonly compact?: boolean;
}) {
  const [data, setData] = useState<MeshStatusApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMeshStatus();
      if (result.kind === 'error') {
        setError(
          result.status === 0
            ? 'Network error loading mesh status. This panel will not invent an online mesh.'
            : `${result.message} Mesh status stays unclaimed until the product API answers.`,
        );
        setData(null);
        return;
      }
      setData(result.data);
    } catch {
      setError(
        'Network error loading mesh status. Retry when the product API is reachable — never treat silence as live peers.',
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const retry = () => setAttempt((n) => n + 1);

  if (loading && !data) {
    return (
      <div className="mesh-status-panel" role="status" aria-busy="true">
        <p className="field-help">Loading mesh / relay product status…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mesh-status-panel" role="alert">
        <p className="field-help">
          {error}{' '}
          <button type="button" className="text-button" onClick={retry}>
            Retry
          </button>
        </p>
        {!compact ? (
          <p className="field-help">
            Machine JSON: <ButtonLink href="/api/v1/mesh" variant="quiet">/api/v1/mesh</ButtonLink>
          </p>
        ) : null}
      </div>
    );
  }

  if (!data) return null;

  const relayConfigured = data.relay.configured === true;
  const productionMesh = data.mesh.productionMeshDeployed === false ? false : false;
  const multiReplicaSafe = data.relay.multiReplicaSafe === false ? false : false;
  const livePeerCount = data.relay.livePeerCount;
  const foundation = data.mesh.foundation ?? 'anyproto/any-sync';
  const note =
    data.note ??
    data.relay.note ??
    'Mesh/relay product status reports configuration honesty only — not live peers.';

  if (compact) {
    return (
      <div className="mesh-status-panel mesh-status-panel--compact" role="status" aria-live="polite">
        <div className="mesh-status-panel__row">
          <StatusBadge tone="degraded">production mesh false</StatusBadge>
          <StatusBadge tone={relayConfigured ? 'pending' : 'neutral'}>
            relay {relayConfigured ? 'configured' : 'unconfigured'}
          </StatusBadge>
          <StatusBadge tone="degraded">multi-replica unsafe</StatusBadge>
          <StatusBadge tone="neutral">live peers unclaimed</StatusBadge>
        </div>
        <p className="field-help">
          Product readiness only — not a peer inventory.{' '}
          <ButtonLink href="/mesh" variant="quiet">
            Mesh detail
          </ButtonLink>{' '}
          ·{' '}
          <ButtonLink href="/api/v1/mesh" variant="quiet">
            /api/v1/mesh
          </ButtonLink>
          {loading ? (
            <>
              {' '}
              <span aria-busy="true">Refreshing…</span>
            </>
          ) : (
            <>
              {' '}
              <button type="button" className="text-button" onClick={retry}>
                Refresh
              </button>
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <section
      className="mesh-status-panel"
      aria-labelledby="mesh-status-title"
      role="status"
      aria-live="polite"
      aria-busy={loading}
    >
      <div className="mesh-status-panel__header">
        <p className="section-kicker">Product API · GET /api/v1/mesh</p>
        <h2 id="mesh-status-title">Honest mesh / relay readiness</h2>
        <p className="field-help">
          Configuration report only. This panel never invents online peers, health probes, or a
          production any-sync deployment.
        </p>
      </div>

      <div className="mesh-status-panel__badges">
        <StatusBadge tone="degraded">productionMeshDeployed: false</StatusBadge>
        <StatusBadge tone={relayConfigured ? 'pending' : 'neutral'}>
          relay configured: {relayConfigured ? 'true' : 'false'}
        </StatusBadge>
        <StatusBadge tone="degraded">multiReplicaSafe: false</StatusBadge>
        <StatusBadge tone="neutral">livePeerCount: null / unclaimed</StatusBadge>
      </div>

      <dl className="mesh-status-panel__dl">
        <div>
          <dt>Foundation</dt>
          <dd>
            <code>{foundation}</code>
          </dd>
        </div>
        <div>
          <dt>productionMeshDeployed</dt>
          <dd>
            <strong>{String(productionMesh)}</strong>
          </dd>
        </div>
        <div>
          <dt>Relay configured</dt>
          <dd>
            <strong>{relayConfigured ? 'true' : 'false'}</strong>
            {data.relay.configuredCount !== undefined
              ? ` · ${data.relay.configuredCount} endpoint(s)`
              : null}
            {data.relay.invalidCount !== undefined && data.relay.invalidCount > 0
              ? ` · ${data.relay.invalidCount} invalid`
              : null}
          </dd>
        </div>
        <div>
          <dt>Display endpoints</dt>
          <dd>
            {data.relay.displayEndpoints.length > 0
              ? data.relay.displayEndpoints.join(' · ')
              : 'none (unconfigured)'}
          </dd>
        </div>
        <div>
          <dt>multiReplicaSafe</dt>
          <dd>
            <strong>{String(multiReplicaSafe)}</strong> — relay state is in-process; never scale-out
            ready from a URL alone
          </dd>
        </div>
        <div>
          <dt>livePeerCount</dt>
          <dd>
            <strong>
              {livePeerCount === null || livePeerCount === undefined
                ? 'null'
                : String(livePeerCount)}
            </strong>{' '}
            · live mesh peers unclaimed (
            {data.relay.liveMeshPeersClaimed === false ? 'false' : 'false'})
          </dd>
        </div>
        {data.mesh.localFirst !== undefined ? (
          <div>
            <dt>Local-first / E2EE spaces</dt>
            <dd>
              localFirst: {String(data.mesh.localFirst)} · e2eeSpaces:{' '}
              {String(data.mesh.e2eeSpaces ?? true)}
            </dd>
          </div>
        ) : null}
        {data.mesh.transports && data.mesh.transports.length > 0 ? (
          <div>
            <dt>Transports</dt>
            <dd>{data.mesh.transports.join(', ')}</dd>
          </div>
        ) : null}
      </dl>

      <p className="field-help">{note}</p>

      {data.mesh.notes && data.mesh.notes.length > 0 ? (
        <ul>
          {data.mesh.notes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}

      <p className="field-help">
        <button type="button" className="text-button" onClick={retry} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh status'}
        </button>
        {' · '}
        <ButtonLink href="/api/v1/mesh" variant="quiet">
          Raw /api/v1/mesh
        </ButtonLink>
        {' · '}
        <ButtonLink href="/status" variant="quiet">
          System status
        </ButtonLink>
        {' · '}
        <ButtonLink href="/settings/providers" variant="quiet">
          Provider settings
        </ButtonLink>
      </p>
    </section>
  );
}
