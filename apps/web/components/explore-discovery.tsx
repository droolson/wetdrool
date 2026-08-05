'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { StatusBadge } from '@wetdrool/ui';

import {
  chipKeyNavIndex,
  emptyDiscoveryMessage,
  personalizationUnconfiguredNote,
  shortSortLabel,
  type RankedShort,
  type ShortSortMode,
} from '@/lib/short-feed';

const SORT_OPTIONS: readonly { id: ShortSortMode; label: string }[] = [
  { id: 'trending', label: 'Trending' },
  { id: 'recent', label: 'Recent' },
];

/**
 * Explore surface: loads ranked shorts from product API.
 * Does not invent trends, people, or engagement counts.
 * Personalization stays explicitly unconfigured (not a fake for-you feed).
 */
export function ExploreDiscovery() {
  const sortListId = useId();
  const sortRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const [items, setItems] = useState<readonly RankedShort[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [synthetic, setSynthetic] = useState(true);
  const [rankingNote, setRankingNote] = useState<string | null>(null);
  const [rankingName, setRankingName] = useState<string | null>(null);
  const [personalizationNote, setPersonalizationNote] = useState(
    personalizationUnconfiguredNote(),
  );
  const [sort, setSort] = useState<ShortSortMode>('trending');
  const [sortLabel, setSortLabel] = useState(shortSortLabel('trending'));
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchShorts } = await import('@/lib/product-client');
      const result = await fetchShorts('all', 12, { sort });
      if (result.kind !== 'ok') {
        setError(result.message);
        setItems([]);
        setEmptyMessage(null);
        return;
      }
      const data = result.data;
      setItems(data.items ?? []);
      setSynthetic(data.synthetic !== false);
      setNote(data.note ?? null);
      setRankingNote(data.ranking?.note ?? null);
      setRankingName(data.ranking?.name ?? null);
      setSortLabel(data.sortLabel ?? shortSortLabel(data.sort ?? sort));
      if (data.personalization?.note) {
        setPersonalizationNote(data.personalization.note);
      } else {
        setPersonalizationNote(personalizationUnconfiguredNote());
      }
      setEmptyMessage(
        data.empty || (data.items?.length ?? 0) === 0
          ? (data.emptyMessage ?? emptyDiscoveryMessage('all', null))
          : null,
      );
    } catch {
      setError('Network error loading discovery.');
      setItems([]);
      setEmptyMessage(null);
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSortKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const ids = SORT_OPTIONS.map((o) => o.id);
      const current = ids.indexOf(sort);
      const next = chipKeyNavIndex(event.key, current < 0 ? 0 : current, ids.length);
      if (next === null) return;
      event.preventDefault();
      setSort(ids[next]!);
      sortRefs.current[next]?.focus();
    },
    [sort],
  );

  return (
    <section className="explore-discovery" aria-labelledby="explore-discovery-title">
      <header className="explore-discovery__header">
        <div>
          <p className="section-kicker">Network discovery</p>
          <h1 id="explore-discovery-title">Find a wider conversation.</h1>
        </div>
        <StatusBadge tone={synthetic ? 'pending' : 'verified'}>
          {loading ? 'loading' : synthetic ? 'synthetic catalog' : 'mixed corpus'}
        </StatusBadge>
      </header>
      <p className="explore-discovery__lede">
        Explore surfaces ranked shorts with explicit ranking notes — not manufactured trends. Public
        search stays separate; personalization providers remain unconfigured.
      </p>
      <p className="field-help">
        <Link href="/hub">Open hub catalog</Link>
        {' · '}
        <Link href="/search">Public search</Link>
        {' · '}
        <Link href="/feeds">Feeds</Link>
      </p>

      <aside
        className="explore-discovery__personalization"
        role="status"
        aria-label="Personalization status"
      >
        <p className="field-help">
          <strong>Personalization unconfigured.</strong> {personalizationNote}
        </p>
      </aside>

      <div
        className="shorts-modes"
        role="tablist"
        aria-label="Discovery sort mode"
        id={sortListId}
        onKeyDown={onSortKeyDown}
      >
        {SORT_OPTIONS.map((option, index) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            id={`${sortListId}-${option.id}`}
            ref={(el) => {
              sortRefs.current[index] = el;
            }}
            tabIndex={sort === option.id ? 0 : -1}
            aria-selected={sort === option.id}
            aria-controls="explore-discovery-list"
            className={sort === option.id ? 'is-active' : undefined}
            onClick={() => setSort(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className="field-help" role="status" aria-live="polite">
        Sort: {sortLabel}
        {rankingName ? ` · Ranking: ${rankingName}` : null}
        {synthetic ? ' · Synthetic fixtures labeled on each card' : null}
      </p>
      {rankingNote ? <p className="field-help">Ranking policy: {rankingNote}</p> : null}
      {note ? <p className="field-help">{note}</p> : null}

      {error ? (
        <div className="field-help" role="alert" aria-live="assertive">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Retry loading discovery sample"
          >
            Retry
          </button>
        </div>
      ) : null}
      {loading ? (
        <p className="field-help" role="status" aria-live="polite">
          Loading discovery sample…
        </p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <div className="shorts-empty" role="status" aria-live="polite">
          <p className="shorts-empty__title">No discovery items</p>
          <p className="field-help">
            {emptyMessage ??
              'No discovery items from the product API. There are no synthetic trends invented here.'}
          </p>
          <button
            type="button"
            className="shorts-empty__reset"
            onClick={() => void load()}
            aria-label="Retry discovery sample load"
          >
            Retry sample
          </button>
        </div>
      ) : null}

      <ul
        id="explore-discovery-list"
        className="explore-discovery__list"
        aria-label="Discovery sample"
        aria-busy={loading}
      >
        {items.map((item) => (
          <li key={item.id}>
            <article className="explore-discovery__card">
              <h2>{item.title}</h2>
              <p className="field-help">
                {item.category}
                {item.synthetic ? ' · synthetic fixture' : ' · licensed/media'}
                {item.syntheticLabel ? ` · ${item.syntheticLabel}` : null}
              </p>
              {item.score !== undefined ? (
                <p className="field-help">Rank score: {item.score.toFixed(2)} (local recipe)</p>
              ) : null}
              {item.why?.length ? (
                <p className="field-help">
                  <span className="visually-hidden">Ranking reasons: </span>
                  Why: {item.why.join(' · ')}
                </p>
              ) : null}
            </article>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void load()}
        disabled={loading}
        aria-busy={loading}
        aria-label="Refresh discovery sample"
      >
        {loading ? 'Refreshing…' : 'Refresh sample'}
      </button>
    </section>
  );
}
