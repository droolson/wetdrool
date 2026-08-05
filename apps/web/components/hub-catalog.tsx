'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { StatusBadge } from '@wetdrool/ui';

import {
  listShortCategories,
  rankShorts,
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
  const [cat, setCat] = useState<string>('all');
  const [mode, setMode] = useState<DiscoveryMode>('all');
  const [categories, setCategories] = useState<readonly string[]>(() => [
    'all',
    ...listShortCategories(),
  ]);
  const [items, setItems] = useState<readonly RankedShort[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'api' | 'local'>('local');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setMode(readDiscoveryMode(window.localStorage));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchShorts } = await import('@/lib/product-client');
      const result = await fetchShorts(mode, 48, {
        category: cat === 'all' ? null : cat,
      });
      if (result.kind === 'ok') {
        setItems(result.data.items);
        setSource('api');
        setNote(result.data.note ?? null);
        if (result.data.categories?.length) {
          setCategories(['all', ...result.data.categories]);
        }
      } else {
        const local = rankShorts(mode, 48).filter((c) => cat === 'all' || c.category === cat);
        setItems(local);
        setSource('local');
        setError(result.message);
        setNote('Local catalog fallback.');
      }
    } catch {
      const local = rankShorts(mode, 48).filter((c) => cat === 'all' || c.category === cat);
      setItems(local);
      setSource('local');
      setError('Network error loading hub catalog.');
    } finally {
      setLoading(false);
    }
  }, [mode, cat]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectMode = (next: DiscoveryMode) => {
    writeDiscoveryMode(window.localStorage, next);
    setMode(next);
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
      </p>
      {note ? <p className="field-help">{note}</p> : null}
      {error ? (
        <p className="field-help" role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      ) : null}

      <div className="hub-cats" role="tablist" aria-label="Discovery mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            className={mode === m.id ? 'is-active' : undefined}
            onClick={() => selectMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="hub-cats" role="toolbar" aria-label="Categories">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
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
          <li className="field-help">No tiles for this filter.</li>
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
                {item.syntheticLabel ?? (item.synthetic ? 'SYNTHETIC' : 'LICENSED')}
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
    </div>
  );
}
