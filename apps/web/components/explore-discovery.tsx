'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import type { RankedShort } from '@/lib/short-feed';

/**
 * Explore surface: loads ranked shorts from product API.
 * Does not invent trends, people, or engagement counts.
 */
export function ExploreDiscovery() {
  const [items, setItems] = useState<readonly RankedShort[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [synthetic, setSynthetic] = useState(true);
  const [rankingNote, setRankingNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchShorts } = await import('@/lib/product-client');
      const result = await fetchShorts('all', 12);
      if (result.kind !== 'ok') {
        setError(result.message);
        setItems([]);
        return;
      }
      setItems(result.data.items ?? []);
      setSynthetic(result.data.synthetic !== false);
      setNote(result.data.note ?? null);
      setRankingNote(result.data.ranking?.note ?? result.data.ranking?.name ?? null);
    } catch {
      setError('Network error loading discovery.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      {rankingNote ? <p className="field-help">Ranking: {rankingNote}</p> : null}
      {note ? <p className="field-help">{note}</p> : null}
      {error ? (
        <p className="field-help" role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      ) : null}
      {loading ? (
        <p className="field-help" role="status">
          Loading discovery sample…
        </p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <p className="field-help" role="status">
          No discovery items from the product API. There are no synthetic trends invented here.
        </p>
      ) : null}
      <ul className="explore-discovery__list" aria-label="Discovery sample" aria-busy={loading}>
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
            </article>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => void load()} disabled={loading}>
        Refresh sample
      </button>
    </section>
  );
}
