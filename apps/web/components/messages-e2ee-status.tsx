'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import type { E2eeApiResponse, ProductClientResult } from '@/lib/product-client';

/**
 * Client e2ee status for /messages — never invents an inbox or unread DMs.
 */
export function MessagesE2eeStatus() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<E2eeApiResponse | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchE2eeStatus } = await import('@/lib/product-client');
      const result: ProductClientResult<E2eeApiResponse> = await fetchE2eeStatus();
      if (result.kind !== 'ok') {
        setError(result.message);
        setReport(null);
        return;
      }
      setReport(result.data);
    } catch {
      setError('Network error loading E2EE status.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  return (
    <section className="card-panel" aria-labelledby="messages-e2ee-api" aria-busy={loading}>
      <div className="rooms-index__heading-row">
        <h2 id="messages-e2ee-api">Product E2EE probe</h2>
        <button type="button" disabled={loading} onClick={() => setAttempt((n) => n + 1)}>
          {loading ? 'Checking…' : 'Retry'}
        </button>
      </div>
      <p className="field-help">
        From <code>/api/v1/e2ee</code>. No pairwise inbox is fabricated. Unread counts stay empty
        until identity + device store wire.
      </p>
      {error ? (
        <p className="field-help" role="alert">
          {error}
        </p>
      ) : null}
      {report ? (
        <div className="rooms-index__meta" aria-live="polite">
          <StatusBadge tone="pending">pairwise: {report.e2ee.pairwise}</StatusBadge>
          <StatusBadge tone="neutral">groups: {report.e2ee.groupRooms}</StatusBadge>
          <StatusBadge tone="verified">rooms: {report.e2ee.passphraseRooms}</StatusBadge>
          <StatusBadge tone="pending">
            hostReadsPlaintext: {String(report.rooms.hostReadsPlaintext)}
          </StatusBadge>
          <StatusBadge tone="pending">
            multiReplicaSafe: {String(report.rooms.store?.multiReplicaSafe === true)}
          </StatusBadge>
        </div>
      ) : null}
      {report?.note ? <p className="field-help">{report.note}</p> : null}
      <p className="field-help">
        Passphrase rooms alpha:{' '}
        <Link href="/rooms">Open rooms index</Link> · seal{' '}
        <code>{report?.e2ee.roomSealProtocol ?? '…'}</code>
      </p>
      <p className="field-help" role="status">
        Unread DMs: 0 (not projected — inbox not wired).
      </p>
    </section>
  );
}
