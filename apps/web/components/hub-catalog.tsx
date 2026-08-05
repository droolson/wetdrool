'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { StatusBadge } from '@wetdrool/ui';

import {
  chipKeyNavIndex,
  emptyDiscoveryMessage,
  listShortCategories,
  rankShortsPage,
  SHORTS_PAGE_SIZE,
  type DiscoveryMode,
  type RankedShort,
  readDiscoveryMode,
  writeDiscoveryMode,
} from '@/lib/short-feed';

const MODES: readonly { id: DiscoveryMode; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'straight', label: 'Straight' },
  { id: 'pride', label: 'Pride' },
];

/**
 * PH-class catalog grid over the shorts discovery API (synthetic until licensed).
 * Dense, accessible, keyboardable — not a marketing landing.
 */
export function HubCatalog() {
  const modeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const catRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const [cat, setCat] = useState<string>('all');
  const [mode, setMode] = useState<DiscoveryMode>('all');
  const [categories, setCategories] = useState<readonly string[]>(() => [
    'all',
    ...listShortCategories(),
  ]);
  const [items, setItems] = useState<readonly RankedShort[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'api' | 'local'>('local');
  const [note, setNote] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);

  useEffect(() => {
    setMode(readDiscoveryMode(window.localStorage));
  }, []);

  const applyLocal = useCallback(
    (nextMode: DiscoveryMode, nextCat: string, nextOffset: number, append: boolean) => {
      const page = rankShortsPage(nextMode, {
        limit: SHORTS_PAGE_SIZE,
        offset: nextOffset,
        category: nextCat === 'all' ? null : nextCat,
      });
      setItems((prev) => (append ? [...prev, ...page.items] : page.items));
      setTotal(page.total);
      setHasMore(page.hasMore);
      setOffset(nextOffset);
      setEmptyMessage(page.total === 0 ? emptyDiscoveryMessage(nextMode, nextCat) : null);
      setSource('local');
      setNote('Local catalog fallback.');
    },
    [],
  );

  const load = useCallback(
    async (opts?: { readonly append?: boolean; readonly nextOffset?: number }) => {
      const append = opts?.append === true;
      const nextOffset = opts?.nextOffset ?? 0;
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setOffset(0);
      }
      setError(null);
      try {
        const { fetchShorts } = await import('@/lib/product-client');
        const result = await fetchShorts(mode, SHORTS_PAGE_SIZE, {
          category: cat === 'all' ? null : cat,
          offset: nextOffset,
        });
        if (result.kind === 'ok') {
          const nextItems = result.data.items;
          setItems((prev) => (append ? [...prev, ...nextItems] : nextItems));
          setSource('api');
          setNote(result.data.note ?? null);
          setTotal(result.data.total ?? nextItems.length);
          setHasMore(Boolean(result.data.hasMore));
          setOffset(nextOffset);
          setEmptyMessage(
            result.data.empty
              ? (result.data.emptyMessage ?? emptyDiscoveryMessage(mode, cat))
              : nextItems.length === 0
                ? emptyDiscoveryMessage(mode, cat)
                : null,
          );
          if (result.data.categories?.length) {
            setCategories(['all', ...result.data.categories]);
          }
        } else {
          applyLocal(mode, cat, nextOffset, append);
          setError(result.message);
        }
      } catch {
        applyLocal(mode, cat, nextOffset, append);
        setError('Network error loading hub catalog.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [mode, cat, applyLocal],
  );

  useEffect(() => {
    void load({ append: false, nextOffset: 0 });
  }, [load]);

  const selectMode = (next: DiscoveryMode) => {
    writeDiscoveryMode(window.localStorage, next);
    setMode(next);
  };

  const onModeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const ids = MODES.map((m) => m.id);
    const current = ids.indexOf(mode);
    const next = chipKeyNavIndex(event.key, current, ids.length);
    if (next === null) return;
    event.preventDefault();
    selectMode(ids[next]!);
    modeRefs.current[next]?.focus();
  };

  const onCatKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = categories.indexOf(cat);
    const next = chipKeyNavIndex(event.key, current < 0 ? 0 : current, categories.length);
    if (next === null) return;
    event.preventDefault();
    setCat(categories[next]!);
    catRefs.current[next]?.focus();
  };

  const loadMore = () => {
    if (!hasMore || loading || loadingMore) return;
    void load({ append: true, nextOffset: offset + SHORTS_PAGE_SIZE });
  };

  return (
    <div className="hub-catalog">
      <header className="hub-catalog__header">
        <div>
          <p className="section-kicker">Hub · decentralized catalog</p>
          <h1>Browse. Filter. Own the client.</h1>
        </div>
        <div className="hub-catalog__actions">
          <StatusBadge tone={source === 'api' ? 'pending' : 'degraded'}>
            {loading ? 'loading' : source === 'api' ? 'api ranked' : 'local fallback'}
          </StatusBadge>
          <Link className="hub-catalog__shorts" href="/feeds">
            Open shorts →
          </Link>
        </div>
      </header>
      <p className="hub-catalog__lede">
        Tube-style discovery over portable manifests. Cards are abstract fixtures until licensed,
        consented creator media is online. Mesh/any-sync carries private objects; Solana anchors
        identity. Every synthetic tile is labeled — no silent fake media.
        {total > 0 ? ` · ${items.length} of ${total}` : ''}
      </p>
      {note ? <p className="field-help">{note}</p> : null}
      {error ? (
        <p className="field-help" role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load({ append: false, nextOffset: 0 })}>
            Retry
          </button>
        </p>
      ) : null}

      <div
        className="hub-cats"
        role="tablist"
        aria-label="Discovery mode"
        onKeyDown={onModeKeyDown}
      >
        {MODES.map((m, index) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            ref={(el) => {
              modeRefs.current[index] = el;
            }}
            tabIndex={mode === m.id ? 0 : -1}
            aria-selected={mode === m.id}
            className={mode === m.id ? 'is-active' : undefined}
            onClick={() => selectMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="hub-cats" role="toolbar" aria-label="Categories" onKeyDown={onCatKeyDown}>
        {categories.map((c, index) => (
          <button
            key={c}
            type="button"
            ref={(el) => {
              catRefs.current[index] = el;
            }}
            tabIndex={cat === c ? 0 : -1}
            className={cat === c ? 'is-active' : undefined}
            aria-pressed={cat === c}
            onClick={() => setCat(c)}
          >
            {c === 'all' ? 'All' : c}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="field-help" role="status">
          Loading ranked catalog…
        </p>
      ) : null}

      <ul className="hub-grid" aria-label="Catalog" aria-busy={loading}>
        {!loading && items.length === 0 ? (
          <li className="shorts-empty hub-empty" role="status">
            <p className="shorts-empty__title">No tiles for this filter</p>
            <p className="field-help">
              {emptyMessage ?? emptyDiscoveryMessage(mode, cat === 'all' ? null : cat)}
            </p>
            <button type="button" className="shorts-empty__reset" onClick={() => setCat('all')}>
              Reset category to All
            </button>
          </li>
        ) : null}
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.dropHref ?? '/feeds'}
              className="hub-tile"
              data-synthetic={item.synthetic ? 'true' : 'false'}
              style={
                {
                  '--tone-a': item.toneA,
                  '--tone-b': item.toneB,
                } as CSSProperties
              }
            >
              <span className="hub-tile__label">{item.category}</span>
              <span className="hub-tile__badge">
                {item.syntheticLabel ??
                  (item.synthetic ? 'SYNTHETIC FIXTURE · abstract only' : 'LICENSED MEDIA')}
              </span>
              <span className="hub-tile__title">{item.title}</span>
              <span className="hub-tile__creator">
                {item.creator}
                {item.synthetic ? ' · fixture' : ' · real media'} · score {item.score.toFixed(2)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {!loading && hasMore ? (
        <div className="shorts-load-more">
          <button
            type="button"
            className="shorts-load-more__btn"
            disabled={loadingMore}
            onClick={loadMore}
            aria-busy={loadingMore}
          >
            {loadingMore ? 'Loading more…' : `Load more · ${total - items.length} remaining`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
