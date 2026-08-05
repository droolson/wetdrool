'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import { StatusBadge } from '@wetdrool/ui';

import {
  chipKeyNavIndex,
  emptyDiscoveryMessage,
  listShortCategories,
  type DiscoveryMode,
  rankShortsPage,
  readDiscoveryMode,
  writeDiscoveryMode,
  type RankedShort,
  contentWarningLabel,
  SHORTS_PAGE_SIZE,
} from '@/lib/short-feed';
import {
  awardPoints,
  fundAdCap,
  loadCap,
  loadLedger,
  saveCap,
  saveLedger,
  type PointsLedgerV1,
} from '@/lib/points-ledger';
import { readAgeGate, readContentMode, writeAgeGate, type ContentMode } from '@/lib/nsfw-mode';

const MODES: readonly { id: DiscoveryMode; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'straight', label: 'Straight' },
  { id: 'pride', label: 'Pride' },
];

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ShortFeed() {
  const modeListId = useId();
  const catListId = useId();
  const modeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const catRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const [mode, setMode] = useState<DiscoveryMode>('all');
  const [category, setCategory] = useState<string>('all');
  const [categories, setCategories] = useState<readonly string[]>(() => listShortCategories());
  const [contentMode, setContentMode] = useState<ContentMode>('sfw');
  const [ageOk, setAgeOk] = useState(false);
  const [ledger, setLedger] = useState<PointsLedgerV1 | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [clips, setClips] = useState<readonly RankedShort[]>([]);
  const [source, setSource] = useState<'api' | 'local'>('local');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiNote, setApiNote] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);

  useEffect(() => {
    setMode(readDiscoveryMode(window.localStorage));
    setContentMode(readContentMode(window.localStorage));
    setAgeOk(readAgeGate(window.localStorage).confirmed);
    setLedger(loadLedger(window.localStorage));
  }, []);

  const applyLocalPage = useCallback(
    (nextMode: DiscoveryMode, nextCategory: string, nextOffset: number, append: boolean) => {
      const page = rankShortsPage(nextMode, {
        limit: SHORTS_PAGE_SIZE,
        offset: nextOffset,
        category: nextCategory === 'all' ? null : nextCategory,
      });
      setClips((prev) => (append ? [...prev, ...page.items] : page.items));
      setTotal(page.total);
      setHasMore(page.hasMore);
      setOffset(nextOffset);
      setEmptyMessage(
        page.total === 0 ? emptyDiscoveryMessage(nextMode, nextCategory) : null,
      );
      setApiNote('Local ranking fallback.');
      setSource('local');
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
          category: category === 'all' ? null : category,
          offset: nextOffset,
        });
        if (result.kind === 'ok') {
          const items = result.data.items;
          setClips((prev) => (append ? [...prev, ...items] : items));
          setSource('api');
          setTotal(result.data.total ?? items.length);
          setHasMore(Boolean(result.data.hasMore));
          setOffset(nextOffset);
          setApiNote(result.data.note ?? result.data.ranking?.note ?? null);
          setEmptyMessage(
            result.data.empty
              ? (result.data.emptyMessage ?? emptyDiscoveryMessage(mode, category))
              : items.length === 0
                ? emptyDiscoveryMessage(mode, category)
                : null,
          );
          if (result.data.categories?.length) setCategories(result.data.categories);
        } else {
          applyLocalPage(mode, category, nextOffset, append);
          setError(result.message);
        }
      } catch {
        applyLocalPage(mode, category, nextOffset, append);
        setError('Network error loading shorts.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [mode, category, applyLocalPage],
  );

  useEffect(() => {
    void load({ append: false, nextOffset: 0 });
  }, [load]);

  const loadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore) return;
    void load({ append: true, nextOffset: offset + SHORTS_PAGE_SIZE });
  }, [hasMore, loading, loadingMore, load, offset]);

  const selectMode = useCallback((next: DiscoveryMode) => {
    writeDiscoveryMode(window.localStorage, next);
    setMode(next);
  }, []);

  const onModeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const ids = MODES.map((m) => m.id);
      const current = ids.indexOf(mode);
      const next = chipKeyNavIndex(event.key, current, ids.length);
      if (next === null) return;
      event.preventDefault();
      selectMode(ids[next]!);
      modeRefs.current[next]?.focus();
    },
    [mode, selectMode],
  );

  const categoryOptions = ['all', ...categories];
  const onCategoryKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const current = categoryOptions.indexOf(category);
      const next = chipKeyNavIndex(event.key, current < 0 ? 0 : current, categoryOptions.length);
      if (next === null) return;
      event.preventDefault();
      const value = categoryOptions[next]!;
      setCategory(value);
      catRefs.current[next]?.focus();
    },
    [category, categoryOptions],
  );

  const confirmAge = useCallback(() => {
    writeAgeGate(window.localStorage, true);
    setAgeOk(true);
    window.localStorage.setItem('wetdrool.contentMode', 'nsfw');
    setContentMode('nsfw');
  }, []);

  const completeWatch = useCallback(
    (clip: RankedShort) => {
      if (!ageOk || contentMode !== 'nsfw') return;
      let cap = loadCap(window.localStorage);
      if (cap.adRevenuePointUnits === 0) {
        cap = fundAdCap(cap, 50);
        saveCap(window.localStorage, cap);
      }
      const current = loadLedger(window.localStorage);
      const result = awardPoints(current, cap, 'watch_complete');
      saveLedger(window.localStorage, result.ledger);
      saveCap(window.localStorage, result.cap);
      setLedger(result.ledger);
      setActiveId(clip.id);
    },
    [ageOk, contentMode],
  );

  const hasRealMedia = clips.some((c) => Boolean(c.mediaSrc) && !c.synthetic);
  const statusLabel = loading
    ? 'loading…'
    : hasRealMedia
      ? `${source} · mixed media`
      : `${source} · synthetic`;

  if (!ageOk || contentMode !== 'nsfw') {
    return (
      <section className="shorts-gate" aria-labelledby="shorts-gate-title">
        <p className="section-kicker">Shorts · RedGIFs energy</p>
        <h1 id="shorts-gate-title">18+ NSFW shorts</h1>
        <p>
          Vertical discovery for consensual adult clips. Current alpha shows{' '}
          <strong>synthetic abstract cards only</strong> — no scraped porn APIs. Confirm age to
          enter NSFW mode (self-attest; no government ID).
        </p>
        <button type="button" className="shorts-gate__cta" onClick={confirmAge}>
          I am 18+ · enter shorts
        </button>
        <p className="field-help">
          Swiss foundation operator (planned) · E2EE private drops on creator surfaces · illegal
          content banned.
        </p>
      </section>
    );
  }

  return (
    <div className="shorts-app">
      <header className="shorts-app__bar">
        <div>
          <p className="section-kicker">/feeds · shorts</p>
          <h1>Drool shorts</h1>
        </div>
        <div className="shorts-app__meta">
          <StatusBadge tone={source === 'api' ? 'pending' : 'degraded'}>{statusLabel}</StatusBadge>
          <span className="points-pill" title="Local points ledger">
            {ledger?.available ?? 0} pts
          </span>
        </div>
      </header>

      <div
        className="shorts-modes"
        role="tablist"
        aria-label="Discovery mode"
        onKeyDown={onModeKeyDown}
      >
        {MODES.map((m, index) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            id={`${modeListId}-${m.id}`}
            ref={(el) => {
              modeRefs.current[index] = el;
            }}
            tabIndex={mode === m.id ? 0 : -1}
            aria-selected={mode === m.id}
            aria-controls="shorts-rail"
            className={mode === m.id ? 'is-active' : undefined}
            onClick={() => selectMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div
        className="shorts-modes"
        role="toolbar"
        aria-label="Category filter"
        id={catListId}
        onKeyDown={onCategoryKeyDown}
      >
        {categoryOptions.map((c, index) => (
          <button
            key={c}
            type="button"
            ref={(el) => {
              catRefs.current[index] = el;
            }}
            tabIndex={category === c ? 0 : -1}
            className={category === c ? 'is-active' : undefined}
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
          >
            {c === 'all' ? 'All cats' : c}
          </button>
        ))}
      </div>

      <p className="shorts-hint">
        Pride emphasizes trans, femboy, and queer creators. Mode is local and never inferred.
        Cards are labeled synthetic fixtures until licensed media exists. Complete a short for
        watch points when the ad-funded pool allows.
        {total > 0 ? ` · ${clips.length} of ${total} ranked` : ''}
        {hasMore ? ' · more available' : ''}
      </p>
      {apiNote ? <p className="field-help">{apiNote}</p> : null}
      {error ? (
        <p className="field-help" role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load({ append: false, nextOffset: 0 })}>
            Retry
          </button>
        </p>
      ) : null}
      {loading ? (
        <p className="field-help" role="status">
          Ranking shorts…
        </p>
      ) : null}

      <ul id="shorts-rail" className="shorts-rail" aria-label="Short feed" aria-busy={loading}>
        {!loading && clips.length === 0 ? (
          <li className="shorts-empty" role="status">
            <p className="shorts-empty__title">Nothing ranked for this filter</p>
            <p className="field-help">
              {emptyMessage ?? emptyDiscoveryMessage(mode, category === 'all' ? null : category)}
            </p>
            <button type="button" className="shorts-empty__reset" onClick={() => setCategory('all')}>
              Reset category to All
            </button>
          </li>
        ) : null}
        {clips.map((clip) => {
          const playable = Boolean(clip.mediaSrc) && !clip.synthetic;
          return (
            <li key={clip.id}>
              <article
                className={
                  playable ? 'short-card short-card--media' : 'short-card short-card--synthetic'
                }
                data-active={activeId === clip.id ? 'true' : 'false'}
                data-synthetic={clip.synthetic ? 'true' : 'false'}
                style={
                  {
                    '--tone-a': clip.toneA,
                    '--tone-b': clip.toneB,
                  } as CSSProperties
                }
              >
                <div className="short-card__stage">
                  {playable && clip.mediaSrc ? (
                    <video
                      className="short-card__video"
                      src={clip.mediaSrc}
                      controls
                      playsInline
                      preload="metadata"
                      aria-label={`${clip.title} video`}
                    />
                  ) : (
                    <span className="short-card__pulse" aria-hidden="true" />
                  )}
                  <span className="short-card__dur">{formatDuration(clip.durationSec)}</span>
                  <span className="short-card__synth-badge" title={contentWarningLabel(clip.contentWarning)}>
                    {clip.syntheticLabel ??
                      (clip.synthetic ? 'SYNTHETIC FIXTURE · abstract only' : 'LICENSED MEDIA')}
                  </span>
                </div>
                <div className="short-card__body">
                  <div className="short-card__tags">
                    <span>{clip.category}</span>
                    <span>{clip.mode}</span>
                    <span>{clip.synthetic ? 'fixture' : 'licensed media'}</span>
                    {!clip.synthetic ? <span>18+</span> : null}
                  </div>
                  <h2>{clip.title}</h2>
                  <p>
                    <Link href={`/creator/${encodeURIComponent(clip.creator.replace(/^@/, ''))}`}>
                      {clip.creator}
                    </Link>
                    <span className="short-card__score"> · score {clip.score.toFixed(2)}</span>
                  </p>
                  <p className="short-card__why">
                    <span className="visually-hidden">Ranking reasons: </span>
                    Why: {clip.why.join(' · ')}
                  </p>
                  <p className="field-help">{contentWarningLabel(clip.contentWarning)}</p>
                  <div className="short-card__actions">
                    <button type="button" onClick={() => completeWatch(clip)}>
                      Finish · +pts
                    </button>
                    {clip.dropHref ? (
                      <Link href={clip.dropHref}>Full drop</Link>
                    ) : (
                      <Link href={`/creator/${encodeURIComponent(clip.creator.replace(/^@/, ''))}`}>
                        Creator
                      </Link>
                    )}
                    <Link href="/live">Go live rooms</Link>
                  </div>
                </div>
              </article>
            </li>
          );
        })}
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
            {loadingMore ? 'Loading more…' : `Load more · ${total - clips.length} remaining`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
