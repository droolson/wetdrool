'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@wetdrool/ui';

interface CompanionRow {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly tones: readonly string[];
  readonly nsfw: boolean;
  readonly hirePointsPerMinute: number;
  readonly model: string;
  readonly blurb: string;
  readonly href: string;
  readonly chatLive: boolean;
  readonly earningsClaimed: boolean;
}

/**
 * Synthetic companion catalog from product API.
 * Never invents live chat sessions or earnings.
 */
export function CompanionsDirectory() {
  const [items, setItems] = useState<readonly CompanionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [syntheticOnly, setSyntheticOnly] = useState(true);
  const [chatLive, setChatLive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchCompanions } = await import('@/lib/product-client');
      const result = await fetchCompanions({ limit: 24, offset: 0 });
      if (result.kind !== 'ok') {
        setError(result.message);
        setItems([]);
        return;
      }
      const rows = (result.data.companions ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        tagline: c.tagline,
        tones: c.tones,
        nsfw: c.nsfw,
        hirePointsPerMinute: c.hirePointsPerMinute,
        model: c.model,
        blurb: c.blurb,
        href: c.href || `/companions/${c.id}`,
        chatLive: c.chatLive === true,
        earningsClaimed: c.earningsClaimed === true,
      }));
      setItems(rows);
      setNote(result.data.note ?? null);
      setSyntheticOnly(result.data.syntheticOnly !== false);
      setChatLive(result.data.chatLive === true);
    } catch {
      setError('Network error loading companions.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="companions-directory" aria-labelledby="companions-api-heading">
      <div className="rooms-index__heading-row">
        <h2 id="companions-api-heading">Catalog (product API)</h2>
        <div className="rooms-index__meta">
          <StatusBadge tone={syntheticOnly ? 'pending' : 'verified'}>
            {loading ? 'loading' : syntheticOnly ? 'syntheticOnly' : 'mixed'}
          </StatusBadge>
          <StatusBadge tone="degraded">chatLive: {String(chatLive)}</StatusBadge>
          <StatusBadge tone="pending">earningsClaimed: false</StatusBadge>
        </div>
      </div>
      {note ? <p className="field-help">{note}</p> : null}
      {loading ? (
        <p className="field-help" role="status">
          Loading companions…
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
          No companions in the product API catalog. Empty is honest — not a silent “all online”
          claim.
        </p>
      ) : null}
      <ul className="companion-grid" aria-busy={loading} aria-label="AI companions">
        {items.map((c) => (
          <li key={c.id} className="companion-card">
            <h3>
              <Link href={c.href}>{c.name}</Link>
            </h3>
            <p className="companion-card__tagline">{c.tagline}</p>
            <p>{c.blurb}</p>
            <p className="field-help">
              {c.model} · {c.hirePointsPerMinute} pts/min staged · chatLive:{' '}
              {String(c.chatLive)} · nsfw:{' '}
              {String(c.nsfw)}
            </p>
            <ul className="creators-directory__tags">
              {c.tones.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <button type="button" disabled>
              Hire (chat not live)
            </button>
          </li>
        ))}
      </ul>
      <p className="field-help">
        API: <code>/api/v1/companions</code>
      </p>
    </section>
  );
}
