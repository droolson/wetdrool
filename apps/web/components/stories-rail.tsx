'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

interface StoryRow {
  readonly id: string;
  readonly ownerHandle: string;
  readonly title: string;
  readonly expiresAt: string;
  readonly synthetic: boolean;
}

export function StoriesRail() {
  const [items, setItems] = useState<readonly StoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchStories } = await import('@/lib/product-client');
      const result = await fetchStories({ limit: 24 });
      if (result.kind !== 'ok') {
        setError(result.message);
        setItems([]);
        return;
      }
      setItems(
        (result.data.stories ?? []).map((story) => ({
          ...story,
          synthetic: story.synthetic !== false,
        })),
      );
      setNote(result.data.note ?? null);
    } catch {
      setError('Network error loading stories.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="stories-api-heading">
      <div className="rooms-index__heading-row">
        <h2 id="stories-api-heading">Story rail (product API)</h2>
        <StatusBadge tone="pending">viewCountsInvented: false</StatusBadge>
      </div>
      {note ? <p className="field-help">{note}</p> : null}
      {loading ? (
        <p className="field-help" role="status">
          Loading story fixtures…
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
          No story fixtures. Empty is honest — no invented rings or watchers.
        </p>
      ) : null}
      <ul className="creators-directory__list" aria-busy={loading} aria-label="Story fixtures">
        {items.map((s) => (
          <li key={s.id}>
            <article className="creators-directory__card">
              <strong>{s.title}</strong>
              <span>@{s.ownerHandle}</span>
              <span className="field-help">
                expires {s.expiresAt}
                {s.synthetic ? ' · synthetic' : ''} · viewCountClaimed: false
              </span>
            </article>
          </li>
        ))}
      </ul>
      <p className="field-help">
        API: <code>/api/v1/stories</code>
      </p>
    </section>
  );
}
