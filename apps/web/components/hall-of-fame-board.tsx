'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { StatusBadge } from '@wetdrool/ui';

import {
  fameTier,
  loadLocalFame,
  rankBoard,
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
  const [board, setBoard] = useState<readonly FameEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const profile = loadLocalFame(window.localStorage);
    const ledger = loadLedger(window.localStorage);
    const synced = syncLocalFameFromPoints(
      window.localStorage,
      ledger.lifetimeEarned,
      ledger.lastCheckinDay,
      profile.handle,
      profile.displayName,
    );
    setLocal(synced);
    setBoard(rankBoard(synced, utcDay()));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
    refresh();
  }, [refresh]);

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
    refresh();
  }, [refresh]);

  return (
    <div className="fame-board">
      <header className="fame-board__header">
        <div>
          <p className="section-kicker">Hall of Fame</p>
          <h1>Grind points. Claim the board.</h1>
        </div>
        <StatusBadge tone="pending">local + seed board</StatusBadge>
      </header>

      <p className="fame-board__lede">
        Reddit-style lifetime points with streaks. Seed creators are fixtures until the global
        ledger is live. Your row syncs from this browser&apos;s points ledger. GitHub push records
        live on branch <code>hall-of-fame</code> (Actions every ~5 min).
      </p>

      <div className="fame-board__you">
        <div>
          <strong>{local?.displayName ?? 'You'}</strong>
          <span>
            {' '}
            · {local?.lifetimePoints ?? 0} lifetime · tier{' '}
            {fameTier(local?.lifetimePoints ?? 0)}
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
        {message ? <p className="fame-board__msg" role="status">{message}</p> : null}
      </div>

      <ol className="fame-board__list" aria-label="Hall of Fame leaderboard">
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
        Push-record ledger (ops): see GitHub branch <code>hall-of-fame</code> →{' '}
        <code>ops/hall-of-fame/counter.json</code>. Product points never invent ad revenue; practice
        pool funds local demo only.
      </p>
    </div>
  );
}
