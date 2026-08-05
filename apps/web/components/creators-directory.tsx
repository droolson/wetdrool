'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

interface CreatorRow {
  readonly handle: string;
  readonly displayName: string;
  readonly tags: readonly string[];
  readonly source: string;
  readonly profilePath: string;
}

const PAGE_SIZE = 12;

function mapRows(
  rows: readonly {
    readonly handle: string;
    readonly displayName: string;
    readonly tags: readonly string[];
    readonly source: string;
    readonly profilePath: string;
  }[],
): CreatorRow[] {
  return rows.map((c) => ({
    handle: c.handle,
    displayName: c.displayName,
    tags: c.tags,
    source: c.source,
    profilePath: c.profilePath,
  }));
}

export function CreatorsDirectory() {
  const [items, setItems] = useState<readonly CreatorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [synthetic, setSynthetic] = useState(true);
  const [source, setSource] = useState<'api' | 'empty' | 'error'>('empty');
  /** Controlled input text. */
  const [queryInput, setQueryInput] = useState('');
  /** Debounced query sent to the API. */
  const [activeQuery, setActiveQuery] = useState('');
  const loadGen = useRef(0);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setActiveQuery(queryInput.trim());
    }, 250);
    return () => window.clearTimeout(handle);
  }, [queryInput]);

  const loadInitial = useCallback(async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    setError(null);
    setLoadingMore(false);
    try {
      const { fetchCreators } = await import('@/lib/product-client');
      const result = await fetchCreators({
        limit: PAGE_SIZE,
        offset: 0,
        q: activeQuery || null,
      });
      if (gen !== loadGen.current) return;
      if (result.kind === 'ok') {
        const rows = mapRows(result.data.creators ?? []);
        setItems(rows);
        setTotal(result.data.total ?? rows.length);
        setHasMore(Boolean(result.data.hasMore));
        setOffset(rows.length);
        setNote(result.data.note ?? null);
        setSynthetic(result.data.synthetic !== false);
        setSource('api');
        setError(null);
      } else {
        setItems([]);
        setTotal(0);
        setHasMore(false);
        setOffset(0);
        setSource('error');
        setError(result.message);
      }
    } catch {
      if (gen !== loadGen.current) return;
      setItems([]);
      setTotal(0);
      setHasMore(false);
      setOffset(0);
      setSource('error');
      setError('Network error loading creators.');
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [activeQuery]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading || source !== 'api') return;
    const gen = loadGen.current;
    setLoadingMore(true);
    setError(null);
    try {
      const { fetchCreators } = await import('@/lib/product-client');
      const result = await fetchCreators({
        limit: PAGE_SIZE,
        offset,
        q: activeQuery || null,
      });
      if (gen !== loadGen.current) return;
      if (result.kind === 'ok') {
        const next = mapRows(result.data.creators ?? []);
        // Empty page: stop pagination even if hasMore was sticky.
        if (next.length === 0) {
          setHasMore(false);
          setTotal(result.data.total ?? total);
          return;
        }
        setItems((prev) => {
          const seen = new Set(prev.map((r) => r.handle));
          const merged = [...prev];
          for (const row of next) {
            if (!seen.has(row.handle)) {
              merged.push(row);
              seen.add(row.handle);
            }
          }
          return merged;
        });
        setHasMore(Boolean(result.data.hasMore));
        setOffset((prev) => prev + next.length);
        setTotal(result.data.total ?? total);
        setNote(result.data.note ?? note);
      } else {
        setError(result.message);
      }
    } catch {
      if (gen !== loadGen.current) return;
      setError('Network error loading more creators.');
    } finally {
      if (gen === loadGen.current) setLoadingMore(false);
    }
  }, [hasMore, loadingMore, loading, source, offset, total, note, activeQuery]);

  useEffect(() => {
    void loadInitial();
    return () => {
      loadGen.current += 1;
    };
  }, [loadInitial]);

  const emptyOk = !loading && items.length === 0 && !error && source === 'api';
  const filteredEmpty = emptyOk && activeQuery.length > 0;
  const badgeLabel = loading
    ? 'loading directory'
    : source === 'error'
      ? 'directory error'
      : synthetic
        ? 'synthetic directory'
        : 'directory';

  return (
    <div className="creators-directory">
      <header className="creators-directory__header">
        <div>
          <p className="section-kicker">Creators · directory</p>
          <h1>Fixture catalog, not a user search.</h1>
        </div>
        <StatusBadge tone={source === 'error' ? 'degraded' : source === 'api' ? 'pending' : 'neutral'}>
          {badgeLabel}
        </StatusBadge>
      </header>
      <p className="field-help">
        Handles below come from founder preview + short-feed fixtures. Checkout remains staged. No
        earnings claims. Filter is local catalog match only (handle, display name, tags).
      </p>
      <form
        className="creators-directory__filter"
        role="search"
        aria-label="Filter synthetic creator catalog"
        onSubmit={(e) => {
          e.preventDefault();
          setActiveQuery(queryInput.trim());
        }}
      >
        <label htmlFor="creators-directory-q">
          Filter fixtures
          <input
            id="creators-directory-q"
            name="q"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="handle, name, or tag…"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            maxLength={64}
          />
        </label>
        {queryInput.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setQueryInput('');
              setActiveQuery('');
            }}
          >
            Clear
          </button>
        ) : null}
      </form>
      {note && source === 'api' ? <p className="field-help">{note}</p> : null}
      {loading ? (
        <p className="field-help" role="status">
          Loading directory…
        </p>
      ) : null}
      {error ? (
        <p className="field-help" role="alert">
          {error}{' '}
          <button type="button" onClick={() => void loadInitial()}>
            Retry
          </button>
        </p>
      ) : null}
      {!loading && source === 'api' ? (
        <p className="field-help" role="status">
          {items.length}
          {total > 0 ? ` / ${total}` : ''} entries
          {activeQuery ? ` · filter “${activeQuery}”` : ''}
          {synthetic ? ' · synthetic catalog' : ''}
        </p>
      ) : null}
      <ul className="creators-directory__list" aria-label="Creator directory" aria-busy={loading}>
        {filteredEmpty ? (
          <li className="field-help" role="status">
            No fixture creators match “{activeQuery}”. This is not a live account search — try another
            handle or tag, or clear the filter.
          </li>
        ) : null}
        {emptyOk && !filteredEmpty ? (
          <li className="field-help" role="status">
            No catalog entries. Directory is empty until fixtures or signed profiles appear.
          </li>
        ) : null}
        {!loading && items.length === 0 && error ? (
          <li className="field-help">Directory unavailable — use Retry above.</li>
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
      {hasMore && source === 'api' && !error ? (
        <p>
          <button type="button" disabled={loadingMore || loading} onClick={() => void loadMore()}>
            {loadingMore ? 'Loading…' : 'Load more creators'}
          </button>
        </p>
      ) : null}
      {!hasMore && source === 'api' && items.length > 0 && !loading ? (
        <p className="field-help" role="status">
          End of synthetic catalog{activeQuery ? ' for this filter' : ''}.
        </p>
      ) : null}
      <p className="field-help">
        API: <code>/api/v1/creators</code>
        {activeQuery ? (
          <>
            {' '}
            · <code>?q={activeQuery}</code>
          </>
        ) : null}{' '}
        · profile <code>/api/v1/creators/:handle</code>
      </p>
    </div>
  );
}
