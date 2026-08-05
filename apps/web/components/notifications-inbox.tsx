'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wetdrool/ui';

import type {
  NotificationItemDto,
  NotificationsApiResponse,
  ProductClientResult,
} from '@/lib/product-client';

export type NotificationFilter = 'all' | 'mentions' | 'communities' | 'system';

const FILTERS: readonly {
  readonly id: NotificationFilter;
  readonly label: string;
  readonly href: string;
}[] = [
  { id: 'all', label: 'All', href: '/notifications' },
  { id: 'mentions', label: 'Mentions', href: '/notifications?filter=mentions' },
  { id: 'communities', label: 'Communities', href: '/notifications?filter=communities' },
  { id: 'system', label: 'System', href: '/notifications?filter=system' },
];

function parseFilter(raw: string | null | undefined): NotificationFilter {
  if (raw === 'mentions' || raw === 'communities' || raw === 'system') return raw;
  return 'all';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Accept only well-formed rows from the product API.
 * Never synthesize placeholders when the payload is missing or partial.
 */
export function normalizeNotificationItems(raw: unknown): readonly NotificationItemDto[] {
  if (!Array.isArray(raw)) return [];
  const out: NotificationItemDto[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    const title = entry.title;
    const category = entry.category;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (typeof title !== 'string' || title.length === 0) continue;
    if (typeof category !== 'string' || category.length === 0) continue;
    const item: NotificationItemDto = {
      id,
      title,
      category,
      ...(typeof entry.body === 'string' ? { body: entry.body } : {}),
      ...(typeof entry.createdAt === 'string' ? { createdAt: entry.createdAt } : {}),
      ...(typeof entry.read === 'boolean' ? { read: entry.read } : {}),
      ...(typeof entry.href === 'string' ? { href: entry.href } : {}),
      ...(typeof entry.actorHandle === 'string' ? { actorHandle: entry.actorHandle } : {}),
    };
    out.push(item);
  }
  return out;
}

function formatCreatedAt(iso: string | undefined): string | null {
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
      title: 'Notification product route is not available yet.',
      detail:
        'GET /api/v1/notifications did not respond successfully. This inbox will not invent mentions, follows, unread counts, or live delivery.',
      badge: 'Route missing',
      tone: 'empty',
    };
  }
  if (status === 401 || status === 403) {
    return {
      eyebrow: 'Session required',
      title: 'No authenticated notification session.',
      detail:
        'The product API rejected this inbox read. Sign in with a passkey once auth is ready, then retry. Empty or denied responses never become fake alerts.',
      badge: 'Auth required',
      tone: 'empty',
    };
  }
  if (status === 0) {
    return {
      eyebrow: 'Network error',
      title: 'Could not reach the product API.',
      detail: 'A network failure blocked the inbox request. Retry when connectivity returns.',
      badge: 'Offline / error',
      tone: 'error',
    };
  }
  return {
    eyebrow: 'Inbox unavailable',
    title: 'Notification inbox failed closed.',
    detail: `The product API returned HTTP ${status}. WetDrool will not fabricate an attention feed from a non-ok response.`,
    badge: `HTTP ${status}`,
    tone: 'error',
  };
}

export function NotificationsInbox({
  initialFilter = null,
}: {
  readonly initialFilter?: string | null;
}) {
  const filter = useMemo(() => parseFilter(initialFilter), [initialFilter]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ readonly status: number; readonly message: string } | null>(
    null,
  );
  const [items, setItems] = useState<readonly NotificationItemDto[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchNotifications } = await import('@/lib/product-client');
      const result: ProductClientResult<NotificationsApiResponse> = await fetchNotifications({
        filter: filter === 'all' ? null : filter,
        limit: 50,
        offset: 0,
      });
      if (result.kind !== 'ok') {
        setError({ status: result.status, message: result.message });
        setItems([]);
        setNote(null);
        setConfigured(null);
        return;
      }
      const data = result.data;
      const normalized = normalizeNotificationItems(data.items);
      setItems(normalized);
      setConfigured(typeof data.configured === 'boolean' ? data.configured : true);
      setNote(typeof data.note === 'string' ? data.note : null);
    } catch {
      setError({ status: 0, message: 'Network error talking to product API.' });
      setItems([]);
      setNote(null);
      setConfigured(null);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const retry = () => setAttempt((n) => n + 1);

  const filterNav = (
    <nav className="filter-strip" aria-label="Notification categories">
      {FILTERS.map((item) => (
        <Link
          key={item.id}
          aria-current={filter === item.id ? 'page' : undefined}
          href={item.href}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );

  if (loading && items.length === 0 && !error) {
    return (
      <div className="notifications-inbox" aria-busy="true" role="status">
        {filterNav}
        <p className="field-help">Loading notification inbox from the product API…</p>
      </div>
    );
  }

  if (error) {
    const panel = statusForHttp(error.status);
    return (
      <div className="notifications-inbox" role="alert">
        {filterNav}
        <div className="notifications-inbox__meta" aria-live="polite">
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
            <ButtonLink href="/settings/providers" variant="quiet">
              Provider settings
            </ButtonLink>
            {' · '}
            <ButtonLink href="/settings/privacy" variant="quiet">
              Privacy
            </ButtonLink>
            {' · '}
            <ButtonLink href="/signin" variant="quiet">
              Sign in
            </ButtonLink>
          </p>
        </StatePanel>
        <HonestCommitments />
      </div>
    );
  }

  const emptyBecauseUnconfigured = configured === false;
  const empty = items.length === 0;

  return (
    <div className="notifications-inbox" aria-live="polite" aria-busy={loading}>
      {filterNav}
      <div className="notifications-inbox__meta">
        <StatusBadge tone={emptyBecauseUnconfigured ? 'neutral' : empty ? 'pending' : 'verified'}>
          {emptyBecauseUnconfigured
            ? 'Unconfigured'
            : empty
              ? 'Empty inbox'
              : `${items.length} notification${items.length === 1 ? '' : 's'}`}
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
            <ButtonLink href="/settings/providers" variant="secondary">
              Review provider settings
            </ButtonLink>
          }
          eyebrow={emptyBecauseUnconfigured ? 'Delivery unconfigured' : 'No signals'}
          headingLevel={2}
          title={
            emptyBecauseUnconfigured
              ? 'Notification delivery is not configured.'
              : filter === 'all'
                ? 'Inbox is empty.'
                : `No ${filter} notifications.`
          }
          tone="empty"
        >
          <p>
            {emptyBecauseUnconfigured
              ? 'No authenticated identity or notification relay is connected. The inbox will not fabricate mentions, follows, unread counts, or live delivery.'
              : 'The product API returned zero items for this filter. An empty list is authoritative — nothing is hidden behind a placeholder.'}
          </p>
          <p className="field-help">
            Mute and quiet-hour preferences live under{' '}
            <Link href="/settings/privacy">privacy settings</Link> once signed preference objects
            land; until then, device-local controls do not invent remote delivery.
          </p>
        </StatePanel>
      ) : (
        <ul className="notifications-inbox__list" aria-label="Notification items">
          {items.map((item) => {
            const when = formatCreatedAt(item.createdAt);
            const content = (
              <>
                <span className="notifications-inbox__category">{item.category}</span>
                <strong>{item.title}</strong>
                {item.body ? <span className="field-help">{item.body}</span> : null}
                <span className="field-help">
                  {item.actorHandle ? `@${item.actorHandle} · ` : null}
                  {when ? <time dateTime={item.createdAt}>{when}</time> : 'time unknown'}
                  {item.read === false ? ' · unread' : null}
                </span>
              </>
            );
            return (
              <li key={item.id} data-notification-id={item.id} data-read={item.read ?? undefined}>
                {item.href ? (
                  <Link className="notifications-inbox__row" href={item.href}>
                    {content}
                  </Link>
                ) : (
                  <div className="notifications-inbox__row">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <HonestCommitments />
    </div>
  );
}

function HonestCommitments() {
  return (
    <section className="product-card-grid" aria-label="Notification design commitments">
      <InfoCard eyebrow="Signal" footer="No anonymous urgency" title="Know what asked for attention" tone="plum">
        <p>
          Mentions, replies, follows, community changes, and system notices carry a typed category
          and source.
        </p>
      </InfoCard>
      <InfoCard
        eyebrow="Control"
        footer="Device preferences stay local"
        title="Attention has boundaries"
        tone="coral"
      >
        <p>
          Mute categories, quiet hours, community notices, and push delivery independently without
          losing protocol history.
        </p>
      </InfoCard>
      <InfoCard
        eyebrow="Resilience"
        footer="Relay is replaceable"
        title="An inbox, not a source of truth"
        tone="sky"
      >
        <p>
          Relay delivery is ephemeral convenience; durable public activity can be reconstructed from
          signed state.
        </p>
      </InfoCard>
    </section>
  );
}
