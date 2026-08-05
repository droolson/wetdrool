'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { StatusBadge } from '@wetdrool/ui';

import {
  FAME_SEED,
  fameTier,
  loadLocalFame,
  rankBoardWithSeed,
  syncLocalFameFromPoints,
  type FameEntry,
  type LocalFameProfile,
} from '@/lib/hall-of-fame';
import {
  awardPoints,
  fundAdCap,
  loadCap,
  loadLedger,
  saveCap,
  saveLedger,
  utcDay,
} from '@/lib/points-ledger';

export function HallOfFameBoard() {
  const [local, setLocal] = useState<LocalFameProfile | null>(null);
  const [seed, setSeed] = useState<readonly FameEntry[]>(FAME_SEED);
  const [board, setBoard] = useState<readonly FameEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [source, setSource] = useState<'api' | 'local'>('local');
  const [loading, setLoading] = useState(true);
  const [apiNote, setApiNote] = useState<string | null>(null);

  const recompute = useCallback((seedBoard: readonly FameEntry[], profile: LocalFameProfile) => {
    setLocal(profile);
    setBoard(rankBoardWithSeed(seedBoard, profile, utcDay()));
  }, []);

  const refreshLocal = useCallback(
    (seedBoard: readonly FameEntry[]) => {
      const profile = loadLocalFame(window.localStorage);
      const ledger = loadLedger(window.localStorage);
      const synced = syncLocalFameFromPoints(
        window.localStorage,
        ledger.lifetimeEarned,
        ledger.lastCheckinDay,
        profile.handle,
        profile.displayName,
      );
      recompute(seedBoard, synced);
    },
    [recompute],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { fetchFameBoard } = await import('@/lib/product-client');
      const result = await fetchFameBoard();
      if (cancelled) return;
      if (result.kind === 'ok' && Array.isArray(result.data.board) && result.data.board.length > 0) {
        const apiSeed: FameEntry[] = result.data.board.map((row) => ({
          handle: row.handle,
          displayName: row.displayName,
          lifetimePoints: row.lifetimePoints,
          streakDays: row.streakDays,
          badges: row.badges,
          source: row.source === 'local' ? ('local' as const) : ('seed' as const),
        }));
        setSeed(apiSeed);
        setSource('api');
        setApiNote(typeof result.data.note === 'string' ? result.data.note : null);
        refreshLocal(apiSeed);
      } else {
        setSeed(FAME_SEED);
        setSource('local');
        setApiNote(
          result.kind === 'error'
            ? result.message
            : 'Empty fame API — using local seed fixtures.',
        );
        refreshLocal(FAME_SEED);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshLocal]);

  const youRank = useMemo(() => {
    if (!local) return null;
    const idx = board.findIndex((e) => e.source === 'local' && e.handle === local.handle);
    return idx >= 0 ? idx + 1 : null;
  }, [board, local]);

  const grindCheckin = useCallback(() => {
    let cap = loadCap(window.localStorage);
    if (cap.adRevenuePointUnits < 50) {
      cap = fundAdCap(cap, 100);
      saveCap(window.localStorage, cap);
    }
    const ledger = loadLedger(window.localStorage);
    const result = awardPoints(ledger, cap, 'checkin');
    saveLedger(window.localStorage, result.ledger);
    saveCap(window.localStorage, result.cap);
    if (result.ok) {
      setMessage(`+${result.awarded} pts check-in. Keep the streak.`);
    } else if (result.reason === 'already-checkin') {
      setMessage('Already checked in today (UTC). Finish shorts for more.');
    } else {
      setMessage('Issuance capped — fund ads or try watch points on /feeds.');
    }
    refreshLocal(seed);
  }, [refreshLocal, seed]);

  const grindWatch = useCallback(() => {
    let cap = loadCap(window.localStorage);
    if (cap.adRevenuePointUnits < 20) {
      cap = fundAdCap(cap, 50);
      saveCap(window.localStorage, cap);
    }
    const ledger = loadLedger(window.localStorage);
    const result = awardPoints(ledger, cap, 'watch_complete');
    saveLedger(window.localStorage, result.ledger);
    saveCap(window.localStorage, result.cap);
    if (result.ok) {
      setMessage(`+${result.awarded} pts (watch). Climb the board.`);
    } else {
      setMessage('Watch award blocked by cap — check-in or fund practice pool.');
    }
    refreshLocal(seed);
  }, [refreshLocal, seed]);

  return (
    <div className="fame-board">
      <header className="fame-board__header">
        <div>
          <p className="section-kicker">Hall of Fame</p>
          <h1>Grind points. Claim the board.</h1>
        </div>
        <StatusBadge tone={source === 'api' ? 'pending' : 'degraded'}>
          {loading ? 'loading board' : source === 'api' ? 'api seed + local' : 'local seed'}
        </StatusBadge>
      </header>

      <p className="fame-board__lede">
        Reddit-style lifetime points with streaks. Seed creators are fixtures until the global
        ledger is live. Your row syncs from this browser&apos;s points ledger. GitHub push records
        live on branch <code>hall-of-fame</code> (Actions every ~5 min).
      </p>
      {apiNote ? (
        <p className="field-help" role="status">
          {apiNote}
        </p>
      ) : null}

      <div className="fame-board__you">
        <div>
          <strong>{local?.displayName ?? 'You'}</strong>
          <span>
            {' '}
            · {local?.lifetimePoints ?? 0} lifetime · tier {fameTier(local?.lifetimePoints ?? 0)}
            {youRank ? ` · rank #${youRank}` : ''}
          </span>
        </div>
        <div className="fame-board__actions">
          <button type="button" onClick={grindCheckin}>
            Daily check-in
          </button>
          <button type="button" onClick={grindWatch}>
            +1 watch pts
          </button>
          <Link href="/feeds">Shorts</Link>
          <Link href="/token">Economy</Link>
        </div>
        {message ? (
          <p className="fame-board__msg" role="status">
            {message}
          </p>
        ) : null}
      </div>

      {loading ? (
        <p className="field-help" role="status">
          Loading leaderboard…
        </p>
      ) : null}

      <ol className="fame-board__list" aria-label="Hall of Fame leaderboard" aria-busy={loading}>
        {board.map((entry, i) => (
          <li key={`${entry.source}-${entry.handle}`} data-source={entry.source}>
            <span className="fame-board__rank">#{i + 1}</span>
            <div className="fame-board__who">
              <strong>{entry.displayName}</strong>
              <span>@{entry.handle}</span>
            </div>
            <div className="fame-board__stats">
              <span>{entry.lifetimePoints.toLocaleString()} pts</span>
              <span>{entry.streakDays}d streak</span>
              <span>{fameTier(entry.lifetimePoints)}</span>
            </div>
            <ul className="fame-board__badges">
              {entry.badges.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <p className="field-help">
        Board seed: <code>/api/v1/fame</code>. Push-record ledger (ops): GitHub branch{' '}
        <code>hall-of-fame</code> → <code>ops/hall-of-fame/counter.json</code>. Product points never
        invent ad revenue; practice pool funds local demo only.
      </p>
    </div>
  );
}
