'use client';

import Link from 'next/link';
import { useMemo, useState, type CSSProperties } from 'react';

import { rankShorts, type DiscoveryMode } from '@/lib/short-feed';

const CATS = [
  { id: 'all', label: 'All' },
  { id: 'femboy', label: 'Femboy' },
  { id: 'trans', label: 'Trans' },
  { id: 'queer', label: 'Queer' },
  { id: 'amateur', label: 'Amateur' },
  { id: 'couples', label: 'Couples' },
  { id: 'cosplay', label: 'Cosplay' },
  { id: 'solo', label: 'Solo' },
] as const;

/**
 * PH-class catalog grid over the same synthetic short corpus.
 * Dense, accessible, keyboardable — not a marketing landing.
 */
export function HubCatalog() {
  const [cat, setCat] = useState<string>('all');
  const [mode] = useState<DiscoveryMode>('all');
  const items = useMemo(() => {
    const ranked = rankShorts(mode, 48);
    if (cat === 'all') return ranked;
    return ranked.filter((c) => c.category === cat);
  }, [cat, mode]);

  return (
    <div className="hub-catalog">
      <header className="hub-catalog__header">
        <div>
          <p className="section-kicker">Hub · decentralized catalog</p>
          <h1>Browse. Filter. Own the client.</h1>
        </div>
        <Link className="hub-catalog__shorts" href="/feeds">
          Open shorts →
        </Link>
      </header>
      <p className="hub-catalog__lede">
        Tube-style discovery over portable manifests. Cards below are abstract fixtures until
        licensed, consented creator media is online. Mesh/any-sync carries private objects; Solana
        anchors identity.
      </p>
      <div className="hub-cats" role="toolbar" aria-label="Categories">
        {CATS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={cat === c.id ? 'is-active' : undefined}
            onClick={() => setCat(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <ul className="hub-grid" aria-label="Catalog">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.dropHref ?? '/feeds'}
              className="hub-tile"
              style={
                {
                  '--tone-a': item.toneA,
                  '--tone-b': item.toneB,
                } as CSSProperties
              }
            >
              <span className="hub-tile__label">{item.category}</span>
              <span className="hub-tile__title">{item.title}</span>
              <span className="hub-tile__creator">
                {item.creator}
                {!item.synthetic ? ' · real media' : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
