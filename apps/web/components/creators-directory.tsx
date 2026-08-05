'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

interface CreatorRow {
  readonly handle: string;
  readonly displayName: string;
  readonly tags: readonly string[];
  readonly source: string;
  readonly profilePath: string;
}

export function CreatorsDirectory() {
  const [items, setItems] = useState<readonly CreatorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchCreators } = await import('@/lib/product-client');
      const result = await fetchCreators({ limit: 48 });
      if (result.kind === 'ok') {
        setItems(result.data.creators ?? []);
        setTotal(result.data.total ?? result.data.creators?.length ?? 0);
        setNote(result.data.note ?? null);
      } else {
        setItems([]);
        setError(result.message);
      }
    } catch {
      setError('Network error loading creators.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="creators-directory">
      <header className="creators-directory__header">
        <div>
          <p className="section-kicker">Creators · directory</p>
          <h1>Fixture catalog, not a user search.</h1>
        </div>
        <StatusBadge tone="pending">synthetic directory</StatusBadge>
      </header>
      <p className="field-help">
        Handles below come from founder preview + short-feed fixtures. Checkout remains staged. No
        earnings claims.
      </p>
      {note ? <p className="field-help">{note}</p> : null}
      {loading ? (
        <p className="field-help" role="status">
          Loading directory…
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
      <p className="field-help">{total > 0 ? `${total} entries` : null}</p>
      <ul className="creators-directory__list" aria-label="Creator directory" aria-busy={loading}>
        {!loading && items.length === 0 && !error ? (
          <li className="field-help">No catalog entries.</li>
        ) : null}
        {items.map((c) => (
          <li key={c.handle}>
            <Link href={c.profilePath} className="creators-directory__card">
              <strong>{c.displayName}</strong>
              <span>@{c.handle}</span>
              <span className="field-help">{c.source}</span>
              <ul className="creators-directory__tags">
                {c.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </Link>
          </li>
        ))}
      </ul>
      <p className="field-help">
        API: <code>/api/v1/creators</code> · profile <code>/api/v1/creators/:handle</code>
      </p>
    </div>
  );
}
