'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wetdrool/ui';

import type { EventsApiResponse, ProductClientResult, ProductEventDto } from '@/lib/product-client';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Accept only well-formed event rows from the product API.
 * Never invents attendance, tickets, RSVPs, or calendar authority.
 */
export function normalizeProductEvents(raw: unknown): readonly ProductEventDto[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductEventDto[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    const title = entry.title;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (typeof title !== 'string' || title.length === 0) continue;
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((t): t is string => typeof t === 'string' && t.length > 0)
      : undefined;
    const item: ProductEventDto = {
      id,
      title,
      summary: typeof entry.summary === 'string' ? entry.summary : '',
      startsAt: typeof entry.startsAt === 'string' ? entry.startsAt : '',
      endsAt: typeof entry.endsAt === 'string' ? entry.endsAt : '',
      href: typeof entry.href === 'string' && entry.href.length > 0 ? entry.href : '/events',
      source:
        typeof entry.source === 'string' && entry.source.length > 0
          ? entry.source
          : 'synthetic-catalog',
      synthetic: entry.synthetic !== false,
      attendanceClaimed: false,
      ...(typeof entry.timezone === 'string' ? { timezone: entry.timezone } : {}),
      ...(typeof entry.locationLabel === 'string' ? { locationLabel: entry.locationLabel } : {}),
      ...(entry.liveAttendance === null ? { liveAttendance: null } : {}),
      ...(entry.rsvpOpen === false ? { rsvpOpen: false as const } : {}),
      ...(typeof entry.mode === 'string' ? { mode: entry.mode } : {}),
      ...(tags ? { tags } : {}),
      ticketsLive: false,
    };
    out.push(item);
  }
  return out;
}

/** Prefer `items` (slot A); tolerate lag if the route still returns `events`. */
export function extractEventsPayload(data: EventsApiResponse): unknown {
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.events)) return data.events;
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
      title: 'Event product route is not available yet.',
      detail:
        'GET /api/v1/events did not respond successfully. This page will not invent RSVPs, nearby gatherings, attendance counts, or a global calendar.',
      badge: 'Route missing',
      tone: 'empty',
    };
  }
  if (status === 0) {
    return {
      eyebrow: 'Network error',
      title: 'Could not reach the product API.',
      detail: 'A network failure blocked the events request. Retry when connectivity returns.',
      badge: 'Offline / error',
      tone: 'error',
    };
  }
  return {
    eyebrow: 'Events unavailable',
    title: 'Event directory failed closed.',
    detail: `The product API returned HTTP ${status}. WetDrool will not fabricate an agenda from a non-ok response.`,
    badge: `HTTP ${status}`,
    tone: 'error',
  };
}

export function ProductEvents() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ readonly status: number; readonly message: string } | null>(
    null,
  );
  const [items, setItems] = useState<readonly ProductEventDto[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [syntheticOnly, setSyntheticOnly] = useState(true);
  const [globalCalendar, setGlobalCalendar] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [total, setTotal] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchEvents } = await import('@/lib/product-client');
      const result: ProductClientResult<EventsApiResponse> = await fetchEvents({
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
        setGlobalCalendar(false);
        setConfigured(null);
        return;
      }
      const data = result.data;
      const normalized = normalizeProductEvents(extractEventsPayload(data));
      setItems(normalized);
      setTotal(typeof data.total === 'number' ? data.total : normalized.length);
      setNote(typeof data.note === 'string' ? data.note : null);
      setSyntheticOnly(data.syntheticOnly !== false);
      setGlobalCalendar(Boolean(data.globalCalendar));
      setConfigured(data.configured === true);
    } catch {
      setError({ status: 0, message: 'Network error talking to product API.' });
      setItems([]);
      setNote(null);
      setTotal(0);
      setSyntheticOnly(true);
      setGlobalCalendar(false);
      setConfigured(null);
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
      <div className="product-events" aria-busy="true" role="status">
        <p className="field-help">Loading events from the product API…</p>
      </div>
    );
  }

  if (error) {
    const panel = statusForHttp(error.status);
    return (
      <div className="product-events" role="alert">
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
            <ButtonLink href="/communities" variant="quiet">
              Communities
            </ButtonLink>
            {' · '}
            <ButtonLink href="/settings/providers" variant="quiet">
              Provider settings
            </ButtonLink>
          </p>
        </StatePanel>
        <EventCommitments />
      </div>
    );
  }

  const empty = items.length === 0;
  const badgeTone = empty ? 'neutral' : syntheticOnly ? 'pending' : 'verified';
  const badgeLabel = empty
    ? configured === false
      ? 'Empty · unconfigured'
      : 'Empty catalog'
    : syntheticOnly
      ? `Synthetic · ${items.length}`
      : `${items.length} event${items.length === 1 ? '' : 's'}`;

  return (
    <div className="product-events" aria-live="polite" aria-busy={loading}>
      <div className="product-events__meta">
        <StatusBadge tone={badgeTone}>{badgeLabel}</StatusBadge>
        {syntheticOnly && !empty ? (
          <StatusBadge tone="pending">Demo fixtures only</StatusBadge>
        ) : null}
        {configured === false ? (
          <StatusBadge tone="neutral">Calendar unconfigured</StatusBadge>
        ) : null}
        {!globalCalendar ? (
          <StatusBadge tone="neutral">No global calendar</StatusBadge>
        ) : null}
        <StatusBadge tone="neutral">Attendance not claimed</StatusBadge>
        <StatusBadge tone="neutral">Tickets not live</StatusBadge>
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
            <ButtonLink href="/communities" variant="secondary">
              Browse community readiness
            </ButtonLink>
          }
          eyebrow="No event directory"
          headingLevel={2}
          title="No events returned."
          tone="empty"
        >
          <p>
            The product API returned an empty list. WetDrool will not invent nearby gatherings,
            RSVPs, or attendance counts. An empty catalog is authoritative.
          </p>
        </StatePanel>
      ) : (
        <ul className="product-events__list" aria-label="Product events">
          {items.map((event) => {
            const start = formatWhen(event.startsAt);
            const end = formatWhen(event.endsAt);
            const modeOrLocation = event.mode ?? event.locationLabel ?? event.source;
            return (
              <li key={event.id} data-event-id={event.id} data-synthetic={event.synthetic}>
                <article className="product-events__card">
                  <div className="product-events__card-head">
                    <p className="section-kicker">
                      {modeOrLocation}
                      {event.synthetic ? ' · synthetic' : ''}
                    </p>
                    <StatusBadge tone={event.synthetic ? 'pending' : 'verified'}>
                      {event.synthetic ? 'Fixture' : 'Listed'}
                    </StatusBadge>
                  </div>
                  <h3>
                    <Link href={event.href}>{event.title}</Link>
                  </h3>
                  {event.summary ? <p>{event.summary}</p> : null}
                  <p className="field-help">
                    {start ? (
                      <>
                        <time dateTime={event.startsAt}>{start}</time>
                        {end ? (
                          <>
                            {' → '}
                            <time dateTime={event.endsAt}>{end}</time>
                          </>
                        ) : null}
                        {event.timezone ? ` · ${event.timezone}` : null}
                      </>
                    ) : (
                      'Schedule unknown'
                    )}
                  </p>
                  {event.tags && event.tags.length > 0 ? (
                    <p className="field-help" aria-label="Tags">
                      {event.tags.join(' · ')}
                    </p>
                  ) : null}
                  <p className="field-help">
                    Attendance not counted · tickets not live · RSVP not open
                    {total > items.length ? ` · showing ${items.length} of ${total}` : null}
                  </p>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <EventCommitments />
    </div>
  );
}

function EventCommitments() {
  return (
    <section className="product-card-grid" aria-label="Event privacy commitments">
      <InfoCard eyebrow="Attendance" title="RSVP visibility is separate" tone="plum">
        <p>Joining an event never has to publish attendance to the entire network.</p>
      </InfoCard>
      <InfoCard eyebrow="Location" title="Reveal it at the right time" tone="coral">
        <p>Private venue details can remain limited to approved attendees.</p>
      </InfoCard>
      <InfoCard eyebrow="Cancellation" title="Changes are signed state" tone="sky">
        <p>Clients distinguish updates and cancellation from disappearance or stale indexing.</p>
      </InfoCard>
    </section>
  );
}
