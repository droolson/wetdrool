'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ButtonLink, StatePanel, StatusBadge, type StatusTone } from '@wetdrool/ui';

import type { E2eeApiResponse, ProductClientResult } from '@/lib/product-client';

type LoadState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'error'; readonly message: string; readonly status: number }
  | { readonly phase: 'ready'; readonly data: E2eeApiResponse };

function badgeTone(status: string): StatusTone {
  switch (status) {
    case 'web_not_wired':
      return 'pending';
    case 'group_disabled':
    case 'relay_locked':
      return 'unavailable';
    case 'passphrase_rooms_alpha':
      return 'degraded';
    case 'implemented_package':
      return 'verified';
    default:
      return 'neutral';
  }
}

function headerBadge(state: LoadState): { readonly tone: StatusTone; readonly label: string } {
  if (state.phase === 'loading') {
    return { tone: 'pending', label: 'Loading E2EE status…' };
  }
  if (state.phase === 'error') {
    return { tone: 'degraded', label: 'E2EE status unavailable' };
  }
  const pairwise = state.data.e2ee.pairwise;
  if (pairwise === 'web_not_wired') {
    return { tone: 'degraded', label: 'Pairwise · web not wired' };
  }
  return { tone: 'neutral', label: `Pairwise · ${pairwise}` };
}

export function MessagesE2eePanel() {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const { fetchE2eeStatus } = await import('@/lib/product-client');
      const result: ProductClientResult<E2eeApiResponse> = await fetchE2eeStatus();
      if (result.kind !== 'ok') {
        setState({
          phase: 'error',
          message: result.message,
          status: result.status,
        });
        return;
      }
      setState({ phase: 'ready', data: result.data });
    } catch {
      setState({
        phase: 'error',
        message: 'Could not load E2EE capability report.',
        status: 0,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const badge = headerBadge(state);

  return (
    <>
      <div className="rooms-index__meta" aria-live="polite">
        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
        {state.phase === 'ready' && state.data.e2ee.serverReadableFallback === false ? (
          <StatusBadge tone="verified">no server plaintext fallback</StatusBadge>
        ) : null}
        {state.phase === 'ready' && state.data.rooms.ciphertextOnly ? (
          <StatusBadge tone="verified">rooms · ciphertext-only</StatusBadge>
        ) : null}
        {state.phase === 'ready' ? (
          <StatusBadge tone={badgeTone(state.data.e2ee.passphraseRooms)}>
            {state.data.e2ee.passphraseRooms}
          </StatusBadge>
        ) : null}
      </div>

      {state.phase === 'loading' ? (
        <StatePanel eyebrow="E2EE capability" title="Loading capability report…" tone="loading">
          <p role="status">
            Fetching <code>GET /api/v1/e2ee</code>. No inbox is shown until pairwise E2EE is wired.
          </p>
        </StatePanel>
      ) : null}

      {state.phase === 'error' ? (
        <StatePanel
          eyebrow="E2EE capability"
          title="Could not load E2EE status."
          tone="error"
          action={
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          }
        >
          <p role="alert">
            {state.message}
            {state.status > 0 ? ` (HTTP ${state.status})` : null}
          </p>
          <p>
            This page never invents DM threads, unread counts, or a simulated inbox. Retry when the
            product API is reachable.
          </p>
        </StatePanel>
      ) : null}

      {state.phase === 'ready' ? (
        <>
          <section className="e2ee-status" aria-labelledby="e2ee-status-title">
            <div className="rooms-index__meta">
              <h2 id="e2ee-status-title">Capability report</h2>
              <button type="button" onClick={() => void load()}>
                Refresh
              </button>
            </div>
            <p className="field-help" role="note">
              Protocol <code className="inline-identifier">{state.data.e2ee.protocol}</code>
              {' · '}
              room seal <code className="inline-identifier">{state.data.e2ee.roomSealProtocol}</code>
              {' · '}
              server-readable fallback:{' '}
              <strong>{String(state.data.e2ee.serverReadableFallback)}</strong>
              {' · '}
              private by default: <strong>{String(state.data.e2ee.privateByDefault)}</strong>
            </p>
            <dl className="e2ee-status__grid">
              <div>
                <dt>Pairwise DMs</dt>
                <dd>
                  <StatusBadge tone={badgeTone(state.data.e2ee.pairwise)}>
                    {state.data.e2ee.pairwise}
                  </StatusBadge>
                </dd>
              </div>
              <div>
                <dt>Group rooms (Olm)</dt>
                <dd>
                  <StatusBadge tone={badgeTone(state.data.e2ee.groupRooms)}>
                    {state.data.e2ee.groupRooms}
                  </StatusBadge>
                </dd>
              </div>
              <div>
                <dt>Passphrase rooms</dt>
                <dd>
                  <StatusBadge tone={badgeTone(state.data.e2ee.passphraseRooms)}>
                    {state.data.e2ee.passphraseRooms}
                  </StatusBadge>{' '}
                  <Link href="/rooms">Open /rooms</Link>
                </dd>
              </div>
              <div>
                <dt>Room store</dt>
                <dd>
                  <StatusBadge tone="neutral">{state.data.rooms.durability}</StatusBadge>
                </dd>
              </div>
            </dl>
            <ul className="e2ee-status__details">
              {state.data.e2ee.details.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {state.data.note ? <li key="api-note">{state.data.note}</li> : null}
            </ul>
            <div className="hero__actions">
              <ButtonLink href="/rooms" variant="secondary">
                Passphrase rooms (alpha)
              </ButtonLink>
              <ButtonLink href="/messages/group" variant="quiet">
                Group readiness
              </ButtonLink>
              <ButtonLink href="/settings/privacy" variant="quiet">
                Privacy controls
              </ButtonLink>
            </div>
          </section>

          <StatePanel
            eyebrow="No pairwise inbox"
            title="There are no unread DMs to show."
            tone="empty"
          >
            <p>
              Pairwise status is <code>{state.data.e2ee.pairwise}</code> — the web client is not
              connected to a browser-safe device store or key directory. This surface stays locked
              and does not invent threads, previews, or unread badges.
            </p>
            <p>
              For shared-passphrase sealed rooms (alpha, not identity-bound Olm), open the{' '}
              <Link href="/rooms">rooms index</Link>. Ciphertext-only store:{' '}
              {state.data.rooms.hostReadsPlaintext
                ? 'host may read plaintext (unexpected)'
                : 'host does not read plaintext'}
              .
            </p>
          </StatePanel>
        </>
      ) : null}
    </>
  );
}
