'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

interface PhotoRow {
  readonly id: string;
  readonly title: string;
  readonly creator: string;
  readonly category: string;
  readonly synthetic: boolean;
}

export function PhotosGallery() {
  const [items, setItems] = useState<readonly PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchPhotos } = await import('@/lib/product-client');
      const result = await fetchPhotos({ limit: 24 });
      if (result.kind !== 'ok') {
        setError(result.message);
        setItems([]);
        return;
      }
      setItems(
        (result.data.photos ?? []).map((photo) => ({
          ...photo,
          category: photo.category ?? 'uncategorized',
          synthetic: photo.synthetic !== false,
        })),
      );
      setNote(result.data.note ?? null);
    } catch {
      setError('Network error loading photos.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="photos-api-heading">
      <div className="rooms-index__heading-row">
        <h2 id="photos-api-heading">Gallery (product API)</h2>
        <StatusBadge tone="pending">syntheticOnly · licensedMedia: false</StatusBadge>
      </div>
      {note ? <p className="field-help">{note}</p> : null}
      {loading ? (
        <p className="field-help" role="status">
          Loading photo fixtures…
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
          No photo fixtures. Empty is honest — not a silent full catalog.
        </p>
      ) : null}
      <ul className="creators-directory__list" aria-busy={loading} aria-label="Photo fixtures">
        {items.map((p) => (
          <li key={p.id}>
            <article className="creators-directory__card">
              <strong>{p.title}</strong>
              <span>{p.creator}</span>
              <span className="field-help">
                {p.category}
                {p.synthetic ? ' · synthetic abstract' : ''}
              </span>
            </article>
          </li>
        ))}
      </ul>
      <p className="field-help">
        API: <code>/api/v1/photos</code>
      </p>
    </section>
  );
}
