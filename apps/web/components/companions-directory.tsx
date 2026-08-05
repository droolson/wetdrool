'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ButtonLink, StatePanel, StatusBadge } from '@wetdrool/ui';

import type {
  CompanionDto,
  CompanionsApiResponse,
  ProductClientResult,
} from '@/lib/product-client';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Accept only well-formed companion rows from the product API.
 * Never invents live chat, earnings, or a hired session.
 */
export function normalizeProductCompanions(raw: unknown): readonly CompanionDto[] {
  if (!Array.isArray(raw)) return [];
  const out: CompanionDto[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    const name = entry.name;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (typeof name !== 'string' || name.length === 0) continue;
    const tones = Array.isArray(entry.tones)
      ? entry.tones.filter((t): t is string => typeof t === 'string' && t.length > 0)
      : [];
    const href =
      typeof entry.href === 'string' && entry.href.length > 0
        ? entry.href
        : `/companions/${encodeURIComponent(id)}`;
    const hirePointsPerMinute =
      typeof entry.hirePointsPerMinute === 'number' && Number.isFinite(entry.hirePointsPerMinute)
        ? entry.hirePointsPerMinute
        : 0;
    const item: CompanionDto = {
      id,
      name,
      tagline: typeof entry.tagline === 'string' ? entry.tagline : '',
      tones,
      nsfw: entry.nsfw === true,
      hirePointsPerMinute,
      model: typeof entry.model === 'string' && entry.model.length > 0 ? entry.model : 'unknown',
      blurb: typeof entry.blurb === 'string' ? entry.blurb : '',
      source:
        typeof entry.source === 'string' && entry.source.length > 0
          ? entry.source
          : 'synthetic-catalog',
      chatLive: false,
      earningsClaimed: false,
      href,
      synthetic: entry.synthetic !== false,
    };
    out.push(item);
  }
  return out;
}

/** Prefer `companions` (slot A); tolerate lag if the route still returns `items`. */
export function extractCompanionsPayload(data: CompanionsApiResponse): unknown {
  if (Array.isArray(data.companions)) return data.companions;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

function statusForHttp(status: number): {
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
  readonly badge: string;
  readonly tone: 'empty' | 'error';
} {
  if (status === 404) {
    return {
      eyebrow: 'API unconfigured',
      title: 'Companion product route is not available yet.',
      detail:
        'GET /api/v1/companions did not respond successfully. This page will not invent personas, live DM sessions, or earnings from a missing route.',
      badge: 'Route missing',
      tone: 'empty',
    };
  }
  if (status === 0) {
    return {
      eyebrow: 'Network error',
      title: 'Could not reach the product API.',
      detail: 'A network failure blocked the companions request. Retry when connectivity returns.',
      badge: 'Offline / error',
      tone: 'error',
    };
  }
  return {
    eyebrow: 'Companions unavailable',
    title: 'Companion directory failed closed.',
    detail: `The product API returned HTTP ${status}. WetDrool will not re-fanout local fixtures from a non-ok response.`,
    badge: `HTTP ${status}`,
    tone: 'error',
  };
}

/**
 * Client companions directory backed by GET /api/v1/companions.
 * Loading / error / empty / synthetic badges only — never invents live chat or earnings.
 * HTTP 404 and other non-ok responses fail closed to an empty catalog (no local re-fanout).
 */
export function CompanionsDirectory() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ readonly status: number; readonly message: string } | null>(
    null,
  );
  const [items, setItems] = useState<readonly CompanionDto[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [syntheticOnly, setSyntheticOnly] = useState(true);
  const [chatLive, setChatLive] = useState(false);
  const [earningsClaimed, setEarningsClaimed] = useState(false);
  const [total, setTotal] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchCompanions } = await import('@/lib/product-client');
      const result: ProductClientResult<CompanionsApiResponse> = await fetchCompanions({
        limit: 24,
        offset: 0,
      });
      if (result.kind !== 'ok') {
        // Fail closed (including 404): empty list, no invented fixtures / re-fanout.
        setError({ status: result.status, message: result.message });
        setItems([]);
        setNote(null);
        setTotal(0);
        setSyntheticOnly(true);
        setChatLive(false);
        setEarningsClaimed(false);
        return;
      }
      const data = result.data;
      const normalized = normalizeProductCompanions(extractCompanionsPayload(data));
      setItems(normalized);
      setTotal(typeof data.total === 'number' ? data.total : normalized.length);
      setNote(typeof data.note === 'string' ? data.note : null);
      setSyntheticOnly(data.syntheticOnly !== false && data.synthetic !== false);
      setChatLive(data.chatLive === true);
      setEarningsClaimed(data.earningsClaimed === true);
    } catch {
      setError({ status: 0, message: 'Network error talking to product API.' });
      setItems([]);
      setNote(null);
      setTotal(0);
      setSyntheticOnly(true);
      setChatLive(false);
      setEarningsClaimed(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const retry = () => setAttempt((n) => n + 1);

  if (loading && items.length === 0 && !error) {
    return (
      <div className="companions-directory" aria-busy="true" role="status">
        <p className="field-help">Loading companions from the product API…</p>
      </div>
    );
  }

  if (error) {
    const panel = statusForHttp(error.status);
    return (
      <div className="companions-directory" role="alert">
        <div className="product-events__meta" aria-live="polite">
          <StatusBadge tone={panel.tone === 'error' ? 'degraded' : 'neutral'}>
            {panel.badge}
          </StatusBadge>
          <button type="button" className="auth-service-status__retry" onClick={retry}>
            Retry
          </button>
        </div>
        <StatePanel eyebrow={panel.eyebrow} headingLevel={2} title={panel.title} tone={panel.tone}>
          <p>{panel.detail}</p>
          {error.message ? <p className="field-help">{error.message}</p> : null}
          <p className="field-help">
            Related:{' '}
            <ButtonLink href="/ai" variant="quiet">
              Drool AI
            </ButtonLink>
            {' · '}
            <ButtonLink href="/messages" variant="quiet">
              Messages
            </ButtonLink>
          </p>
        </StatePanel>
      </div>
    );
  }

  const empty = items.length === 0;
  const badgeTone = empty ? 'neutral' : syntheticOnly ? 'pending' : 'verified';
  const badgeLabel = empty
    ? 'Empty catalog'
    : syntheticOnly
      ? `Synthetic · ${items.length}`
      : `${items.length} companion${items.length === 1 ? '' : 's'}`;

  return (
    <div className="companions-directory" aria-live="polite" aria-busy={loading}>
      <div className="product-events__meta">
        <StatusBadge tone={badgeTone}>{badgeLabel}</StatusBadge>
        {syntheticOnly && !empty ? (
          <StatusBadge tone="pending">Demo fixtures only</StatusBadge>
        ) : null}
        <StatusBadge tone={chatLive ? 'verified' : 'neutral'}>
          {chatLive ? 'Chat live' : 'Chat not live'}
        </StatusBadge>
        <StatusBadge tone={earningsClaimed ? 'degraded' : 'neutral'}>
          {earningsClaimed ? 'Earnings claimed' : 'No earnings claimed'}
        </StatusBadge>
        <button
          type="button"
          className="auth-service-status__retry"
          onClick={retry}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {note ? (
        <p className="field-help" role="note">
          {note}
        </p>
      ) : null}

      {empty ? (
        <StatePanel
          action={
            <ButtonLink href="/ai" variant="secondary">
              Open Drool AI
            </ButtonLink>
          }
          eyebrow="No companion directory"
          headingLevel={2}
          title="No companions returned."
          tone="empty"
        >
          <p>
            The product API returned an empty list. WetDrool will not invent personas, hire rates,
            or live DM sessions. An empty catalog is authoritative.
          </p>
        </StatePanel>
      ) : (
        <ul className="companion-grid" id="companion-grid" aria-label="AI companions">
          {items.map((c) => {
            const isSynthetic = c.synthetic !== false || c.source === 'synthetic-catalog';
            return (
              <li
                key={c.id}
                className="companion-card"
                data-companion-id={c.id}
                data-synthetic={isSynthetic ? 'true' : 'false'}
              >
                <div className="product-events__card-head">
                  <p className="section-kicker">
                    {c.model}
                    {isSynthetic ? ' · synthetic' : ''}
                    {c.nsfw ? ' · 18+' : ''}
                  </p>
                  <StatusBadge tone={isSynthetic ? 'pending' : 'verified'}>
                    {isSynthetic ? 'Fixture' : 'Listed'}
                  </StatusBadge>
                </div>
                <h2>
                  <Link href={c.href}>{c.name}</Link>
                </h2>
                {c.tagline ? <p className="companion-card__tagline">{c.tagline}</p> : null}
                {c.blurb ? <p>{c.blurb}</p> : null}
                <p>
                  <StatusBadge tone="pending">{c.model}</StatusBadge>{' '}
                  <span>{c.hirePointsPerMinute} pts/min</span>
                </p>
                {c.tones.length > 0 ? (
                  <ul className="tag-row">
                    {c.tones.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="field-help">
                  Chat not live · no earnings
                  {total > items.length ? ` · showing ${items.length} of ${total}` : null}
                </p>
                <ButtonLink href={`/messages?companion=${encodeURIComponent(c.id)}`}>
                  Open DM RP
                </ButtonLink>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
