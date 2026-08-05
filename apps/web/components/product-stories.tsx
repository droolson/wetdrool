'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wetdrool/ui';

import type { ProductClientResult, ProductStoryDto, StoriesApiResponse } from '@/lib/product-client';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Accept only well-formed story rows from the product API.
 * Never invents view counts, watchers, or deletion guarantees.
 */
export function normalizeProductStories(raw: unknown): readonly ProductStoryDto[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductStoryDto[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    const title = entry.title;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (typeof title !== 'string' || title.length === 0) continue;
    const ownerHandle =
      typeof entry.ownerHandle === 'string' && entry.ownerHandle.length > 0
        ? entry.ownerHandle
        : 'unknown';
    const href =
      typeof entry.href === 'string' && entry.href.length > 0 ? entry.href : '/stories';
    const item: ProductStoryDto = {
      id,
      ownerHandle,
      title,
      expiresAt: typeof entry.expiresAt === 'string' ? entry.expiresAt : '',
      href,
      source:
        typeof entry.source === 'string' && entry.source.length > 0
          ? entry.source
          : 'synthetic-catalog',
      synthetic: entry.synthetic !== false,
      viewCountClaimed: false,
      deletionGuaranteed: false,
    };
    out.push(item);
  }
  return out;
}

/** Prefer `stories` (slot A); tolerate lag if the route still returns `items`. */
export function extractStoriesPayload(data: StoriesApiResponse): unknown {
  if (Array.isArray(data.stories)) return data.stories;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

function formatWhen(iso: string): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
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
      title: 'Stories product route is not available yet.',
      detail:
        'GET /api/v1/stories did not respond successfully. This page will not invent view counts, watchers, or network-wide deletion guarantees.',
      badge: 'Route missing',
      tone: 'empty',
    };
  }
  if (status === 0) {
    return {
      eyebrow: 'Network error',
      title: 'Could not reach the product API.',
      detail: 'A network failure blocked the stories request. Retry when connectivity returns.',
      badge: 'Offline / error',
      tone: 'error',
    };
  }
  return {
    eyebrow: 'Stories unavailable',
    title: 'Stories rail failed closed.',
    detail: `The product API returned HTTP ${status}. WetDrool will not re-fanout local fixtures from a non-ok response.`,
    badge: `HTTP ${status}`,
    tone: 'error',
  };
}

/**
 * Client stories rail backed by GET /api/v1/stories.
 * Loading / error / empty / synthetic badges only — never invents view counts.
 * HTTP 404 and other non-ok responses fail closed to an empty catalog (no local re-fanout).
 */
export function ProductStories() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ readonly status: number; readonly message: string } | null>(
    null,
  );
  const [items, setItems] = useState<readonly ProductStoryDto[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [syntheticOnly, setSyntheticOnly] = useState(true);
  const [viewCountsInvented, setViewCountsInvented] = useState(false);
  const [globalDeletionClaimed, setGlobalDeletionClaimed] = useState(false);
  const [total, setTotal] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchStories } = await import('@/lib/product-client');
      const result: ProductClientResult<StoriesApiResponse> = await fetchStories({
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
        setViewCountsInvented(false);
        setGlobalDeletionClaimed(false);
        return;
      }
      const data = result.data;
      const normalized = normalizeProductStories(extractStoriesPayload(data));
      setItems(normalized);
      setTotal(typeof data.total === 'number' ? data.total : normalized.length);
      setNote(typeof data.note === 'string' ? data.note : null);
      setSyntheticOnly(data.syntheticOnly !== false && data.synthetic !== false);
      setViewCountsInvented(data.viewCountsInvented === true);
      setGlobalDeletionClaimed(data.globalDeletionClaimed === true);
    } catch {
      setError({ status: 0, message: 'Network error talking to product API.' });
      setItems([]);
      setNote(null);
      setTotal(0);
      setSyntheticOnly(true);
      setViewCountsInvented(false);
      setGlobalDeletionClaimed(false);
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
      <div className="product-stories" aria-busy="true" role="status">
        <p className="field-help">Loading stories from the product API…</p>
      </div>
    );
  }

  if (error) {
    const panel = statusForHttp(error.status);
    return (
      <div className="product-stories" role="alert">
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
            <ButtonLink href="/photos" variant="quiet">
              Photos
            </ButtonLink>
            {' · '}
            <ButtonLink href="/video" variant="quiet">
              Video
            </ButtonLink>
            {' · '}
            <ButtonLink href="/feed/media" variant="quiet">
              Media feed
            </ButtonLink>
          </p>
        </StatePanel>
        <StoryCommitments />
      </div>
    );
  }

  const empty = items.length === 0;
  const badgeTone = empty ? 'neutral' : syntheticOnly ? 'pending' : 'verified';
  const badgeLabel = empty
    ? 'Empty catalog'
    : syntheticOnly
      ? `Synthetic · ${items.length}`
      : `${items.length} stor${items.length === 1 ? 'y' : 'ies'}`;

  return (
    <div className="product-stories" aria-live="polite" aria-busy={loading}>
      <div className="product-events__meta">
        <StatusBadge tone={badgeTone}>{badgeLabel}</StatusBadge>
        {syntheticOnly && !empty ? (
          <StatusBadge tone="pending">Demo fixtures only</StatusBadge>
        ) : null}
        <StatusBadge tone={viewCountsInvented ? 'degraded' : 'neutral'}>
          {viewCountsInvented ? 'View counts claimed' : 'No view counts'}
        </StatusBadge>
        <StatusBadge tone={globalDeletionClaimed ? 'degraded' : 'neutral'}>
          {globalDeletionClaimed ? 'Deletion claimed' : 'No deletion guarantee'}
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
            <ButtonLink href="/feed/media" variant="secondary">
              Open media feed
            </ButtonLink>
          }
          eyebrow="No stories directory"
          headingLevel={2}
          title="No stories returned."
          tone="empty"
        >
          <p>
            The product API returned an empty list. WetDrool will not invent view counts, watchers,
            or network-wide deletion. An empty catalog is authoritative.
          </p>
        </StatePanel>
      ) : (
        <ul className="product-stories__rail" aria-label="Product stories">
          {items.map((story) => {
            const isSynthetic = story.synthetic !== false || story.source === 'synthetic-catalog';
            const expires = formatWhen(story.expiresAt);
            return (
              <li
                key={story.id}
                data-story-id={story.id}
                data-synthetic={isSynthetic ? 'true' : 'false'}
              >
                <article className="product-events__card product-stories__card">
                  <div className="product-events__card-head">
                    <p className="section-kicker">
                      @{story.ownerHandle}
                      {isSynthetic ? ' · synthetic' : ''}
                    </p>
                    <StatusBadge tone={isSynthetic ? 'pending' : 'verified'}>
                      {isSynthetic ? 'Fixture' : 'Listed'}
                    </StatusBadge>
                  </div>
                  <h3>
                    <Link href={story.href}>{story.title}</Link>
                  </h3>
                  <p className="field-help">
                    {expires ? (
                      <>
                        Expires <time dateTime={story.expiresAt}>{expires}</time>
                      </>
                    ) : (
                      'Expiry unknown'
                    )}
                  </p>
                  <p className="field-help">
                    View counts not claimed · deletion not guaranteed
                    {total > items.length ? ` · showing ${items.length} of ${total}` : null}
                  </p>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <StoryCommitments />
    </div>
  );
}

function StoryCommitments() {
  return (
    <section className="product-card-grid" aria-label="Stories commitments">
      <InfoCard eyebrow="Expiry" title="Temporary, honestly described" tone="plum">
        <p>
          Expiry is signed metadata and a client-display promise, not a claim that public bytes can
          be erased everywhere.
        </p>
      </InfoCard>
      <InfoCard eyebrow="Audience" title="A smaller room by design" tone="coral">
        <p>Audience and reply permissions travel with each story object and are checked before delivery.</p>
      </InfoCard>
      <InfoCard eyebrow="Access" title="Fast does not mean inaccessible" tone="sky">
        <p>Alt text, captions, content warnings, and tap-to-pause controls are part of the format.</p>
      </InfoCard>
    </section>
  );
}
