'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { StatusBadge } from '@wetdrool/ui';

import {
  listShortCategories,
  type DiscoveryMode,
  rankShorts,
  readDiscoveryMode,
  writeDiscoveryMode,
  type RankedShort,
  contentWarningLabel,
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
  const [error, setError] = useState<string | null>(null);
  const [apiNote, setApiNote] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setMode(readDiscoveryMode(window.localStorage));
    setContentMode(readContentMode(window.localStorage));
    setAgeOk(readAgeGate(window.localStorage).confirmed);
    setLedger(loadLedger(window.localStorage));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchShorts } = await import('@/lib/product-client');
      const result = await fetchShorts(mode, 24, {
        category: category === 'all' ? null : category,
      });
      if (result.kind === 'ok' && result.data.items.length > 0) {
        setClips(result.data.items);
        setSource('api');
        setTotal(result.data.total ?? result.data.items.length);
        setApiNote(result.data.note ?? result.data.ranking?.note ?? null);
        if (result.data.categories?.length) setCategories(result.data.categories);
      } else if (result.kind === 'ok') {
        setClips([]);
        setSource('api');
        setTotal(0);
        setApiNote(result.data.note ?? 'No clips for this filter.');
      } else {
        const local = rankShorts(mode, 24).filter(
          (c) => category === 'all' || c.category === category,
        );
        setClips(local);
        setSource('local');
        setTotal(local.length);
        setError(result.message);
        setApiNote('Local ranking fallback.');
      }
    } catch {
      const local = rankShorts(mode, 24).filter(
        (c) => category === 'all' || c.category === category,
      );
      setClips(local);
      setSource('local');
      setError('Network error loading shorts.');
    } finally {
      setLoading(false);
    }
  }, [mode, category]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectMode = useCallback((next: DiscoveryMode) => {
    writeDiscoveryMode(window.localStorage, next);
    setMode(next);
  }, []);

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

      <div className="shorts-modes" role="tablist" aria-label="Discovery mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            id={`shorts-mode-${m.id}`}
            aria-selected={mode === m.id}
            aria-controls="shorts-rail"
            className={mode === m.id ? 'is-active' : undefined}
            onClick={() => selectMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="shorts-modes" role="toolbar" aria-label="Category filter">
        <button
          type="button"
          className={category === 'all' ? 'is-active' : undefined}
          aria-pressed={category === 'all'}
          onClick={() => setCategory('all')}
        >
          All cats
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            className={category === c ? 'is-active' : undefined}
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <p className="shorts-hint">
        Pride emphasizes trans, femboy, and queer creators. Mode is local and never inferred.
        Cards are labeled synthetic until licensed media exists. Complete a short for watch points
        when the ad-funded pool allows.
        {total > 0 ? ` · ${total} ranked` : ''}
      </p>
      {apiNote ? <p className="field-help">{apiNote}</p> : null}
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
          Ranking shorts…
        </p>
      ) : null}

      <ul id="shorts-rail" className="shorts-rail" aria-label="Short feed" aria-busy={loading}>
        {!loading && clips.length === 0 ? (
          <li className="field-help">No clips for this mode/category.</li>
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
                  <span className="short-card__synth-badge">
                    {clip.syntheticLabel ?? (clip.synthetic ? 'SYNTHETIC' : 'LICENSED')}
                  </span>
                </div>
                <div className="short-card__body">
                  <div className="short-card__tags">
                    <span>{clip.category}</span>
                    <span>{clip.mode}</span>
                    <span>{clip.synthetic ? 'abstract' : 'licensed media'}</span>
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
    </div>
  );
}
