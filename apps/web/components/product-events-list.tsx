'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

interface EventRow {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly mode: string;
  readonly tags: readonly string[];
  readonly synthetic: boolean;
  readonly href: string;
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Product events list — synthetic fixtures only.
 * Never invents attendance, tickets, or a live calendar.
 */
export function ProductEventsList() {
  const [items, setItems] = useState<readonly EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [syntheticOnly, setSyntheticOnly] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchEvents } = await import('@/lib/product-client');
      const result = await fetchEvents({ limit: 24, offset: 0 });
      if (result.kind !== 'ok') {
        setError(result.message);
        setItems([]);
        return;
      }
      const rows = (result.data.events ?? []).map((e) => ({
        id: e.id,
        title: e.title,
        summary: e.summary,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        mode: e.mode,
        tags: e.tags,
        synthetic: e.synthetic !== false,
        href: e.href || '/events',
      }));
      setItems(rows);
      setNote(result.data.note ?? null);
      setSyntheticOnly(result.data.syntheticOnly !== false);
    } catch {
      setError('Network error loading events.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="product-events" aria-labelledby="product-events-heading">
      <div className="rooms-index__heading-row">
        <h2 id="product-events-heading">Fixture agenda</h2>
        <StatusBadge tone={syntheticOnly ? 'pending' : 'verified'}>
          {loading ? 'loading' : syntheticOnly ? 'syntheticOnly' : 'mixed'}
        </StatusBadge>
      </div>
      <p className="field-help">
        attendanceClaimed: false · ticketsLive: false · globalCalendar: false
      </p>
      {note ? <p className="field-help">{note}</p> : null}
      {loading ? (
        <p className="field-help" role="status">
          Loading event fixtures…
        </p>
      ) : null}
      {error ? (
        <p className="field-help" role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <p className="field-help" role="status">
          No event fixtures. Empty is honest — not a silent claim that nothing is happening on the
          network.
        </p>
      ) : null}
      <ul className="product-events__list" aria-busy={loading} aria-label="Product events">
        {items.map((e) => (
          <li key={e.id}>
            <article className="product-events__card">
              <h3>
                <Link href={e.href}>{e.title}</Link>
              </h3>
              <p className="field-help">
                {formatWhen(e.startsAt)} → {formatWhen(e.endsAt)} · {e.mode}
                {e.synthetic ? ' · synthetic fixture' : null}
              </p>
              <p>{e.summary}</p>
              <ul className="creators-directory__tags">
                {e.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </article>
          </li>
        ))}
      </ul>
      <p className="field-help">
        API: <code>/api/v1/events</code>
      </p>
    </section>
  );
}
