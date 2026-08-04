'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { StatusBadge } from '@wetdrool/ui';

import {
  type DiscoveryMode,
  rankShorts,
  readDiscoveryMode,
  writeDiscoveryMode,
  type RankedShort,
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

export function ShortFeed() {
  const [mode, setMode] = useState<DiscoveryMode>('all');
  const [contentMode, setContentMode] = useState<ContentMode>('sfw');
  const [ageOk, setAgeOk] = useState(false);
  const [ledger, setLedger] = useState<PointsLedgerV1 | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [clips, setClips] = useState<readonly RankedShort[]>([]);
  const [source, setSource] = useState<'api' | 'local'>('local');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setMode(readDiscoveryMode(window.localStorage));
    setContentMode(readContentMode(window.localStorage));
    setAgeOk(readAgeGate(window.localStorage).confirmed);
    setLedger(loadLedger(window.localStorage));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { fetchShorts } = await import('@/lib/product-client');
      const result = await fetchShorts(mode, 24);
      if (cancelled) return;
      if (result.kind === 'ok' && result.data.items.length > 0) {
        setClips(result.data.items);
        setSource('api');
      } else {
        setClips(rankShorts(mode, 24));
        setSource('local');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

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
      // Demo: if ads have not funded the pool, allow a tiny local practice pool once.
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
          <StatusBadge tone="pending">
            {loading ? 'loading…' : source === 'api' ? 'api · synthetic' : 'local · synthetic'}
          </StatusBadge>
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
            aria-selected={mode === m.id}
            className={mode === m.id ? 'is-active' : undefined}
            onClick={() => selectMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <p className="shorts-hint">
        Pride emphasizes trans, femboy, and queer creators. Mode is local and never inferred.
        Complete a short to earn watch points when the ad-funded pool allows.
      </p>

      <ul className="shorts-rail" aria-label="Short feed">
        {clips.map((clip) => (
          <li key={clip.id}>
            <article
              className="short-card"
              data-active={activeId === clip.id ? 'true' : 'false'}
              style={
                {
                  '--tone-a': clip.toneA,
                  '--tone-b': clip.toneB,
                } as CSSProperties
              }
            >
              <div className="short-card__stage" aria-hidden="true">
                <span className="short-card__pulse" />
                <span className="short-card__dur">
                  {Math.floor(clip.durationSec / 60)}:
                  {String(clip.durationSec % 60).padStart(2, '0')}
                </span>
              </div>
              <div className="short-card__body">
                <div className="short-card__tags">
                  <span>{clip.category}</span>
                  <span>{clip.mode}</span>
                  <span>abstract</span>
                </div>
                <h2>{clip.title}</h2>
                <p>
                  <Link href={`/creator/${encodeURIComponent(clip.creator.replace(/^@/, ''))}`}>
                    {clip.creator}
                  </Link>
                  <span className="short-card__score"> · score {clip.score.toFixed(2)}</span>
                </p>
                <p className="short-card__why">Why: {clip.why.join(' · ')}</p>
                <div className="short-card__actions">
                  <button type="button" onClick={() => completeWatch(clip)}>
                    Finish · +pts
                  </button>
                  <Link href={`/creator/${encodeURIComponent(clip.creator.replace(/^@/, ''))}`}>
                    Creator
                  </Link>
                  <Link href="/live">Go live rooms</Link>
                </div>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
