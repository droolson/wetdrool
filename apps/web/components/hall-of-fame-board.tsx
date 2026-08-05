'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { StatusBadge } from '@wetdrool/ui';

import {
  FAME_SEED,
  fameEntryMatchesQuery,
  fameTier,
  loadLocalFame,
  normalizeFameSearchQuery,
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [apiNote, setApiNote] = useState<string | null>(null);
  const [seedOnly, setSeedOnly] = useState(true);
  const [seedTotal, setSeedTotal] = useState(FAME_SEED.length);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [queryInput, setQueryInput] = useState('');
  /** Debounced query sent to the API (or applied client-side on local seed). */
  const [activeQuery, setActiveQuery] = useState('');
  const loadGen = useRef(0);
  const pageSize = 3;

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

  const mapApiSeed = (
    rows: readonly {
      readonly handle: string;
      readonly displayName: string;
      readonly lifetimePoints: number;
      readonly streakDays: number;
      readonly badges: readonly string[];
      readonly source?: string;
    }[],
  ): FameEntry[] =>
    rows.map((row) => ({
      handle: row.handle,
      displayName: row.displayName,
      lifetimePoints: row.lifetimePoints,
      streakDays: row.streakDays,
      badges: row.badges,
      source: row.source === 'local' ? ('local' as const) : ('seed' as const),
    }));

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setActiveQuery(queryInput.trim());
    }, 250);
    return () => window.clearTimeout(handle);
  }, [queryInput]);

  useEffect(() => {
    let cancelled = false;
    const gen = ++loadGen.current;
    setLoading(true);
    void (async () => {
      const { fetchFameBoard } = await import('@/lib/product-client');
      const q = normalizeFameSearchQuery(activeQuery);
      const result = await fetchFameBoard({
        limit: pageSize,
        offset: 0,
        q,
      });
      if (cancelled || gen !== loadGen.current) return;
      if (result.kind === 'ok' && Array.isArray(result.data.board)) {
        const apiSeed = mapApiSeed(result.data.board);
        setSeed(apiSeed);
        setSource('api');
        setSeedOnly(result.data.seedOnly !== false);
        setSeedTotal(result.data.total ?? apiSeed.length);
        setHasMore(Boolean(result.data.hasMore));
        setOffset(apiSeed.length);
        setApiNote(typeof result.data.note === 'string' ? result.data.note : null);
        refreshLocal(apiSeed);
      } else {
        // Offline / error: filter static fixtures client-side so search still works honestly.
        const normalized = normalizeFameSearchQuery(activeQuery);
        const localSeed = normalized
          ? FAME_SEED.filter((e) => fameEntryMatchesQuery(e, normalized))
          : FAME_SEED;
        setSeed(localSeed);
        setSource('local');
        setSeedOnly(true);
        setSeedTotal(localSeed.length);
        setHasMore(false);
        setOffset(localSeed.length);
        setApiNote(
          result.kind === 'error'
            ? `${result.message} — filtering local seed fixtures.`
            : 'Empty fame API — using local seed fixtures.',
        );
        refreshLocal(localSeed);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshLocal, activeQuery]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || source !== 'api') return;
    setLoadingMore(true);
    try {
      const { fetchFameBoard } = await import('@/lib/product-client');
      const q = normalizeFameSearchQuery(activeQuery);
      const result = await fetchFameBoard({ limit: pageSize, offset, q });
      if (result.kind === 'ok' && Array.isArray(result.data.board)) {
        const next = mapApiSeed(result.data.board);
        const merged = [...seed];
        const seen = new Set(merged.map((e) => e.handle));
        for (const row of next) {
          if (!seen.has(row.handle)) {
            merged.push(row);
            seen.add(row.handle);
          }
        }
        setSeed(merged);
        setHasMore(Boolean(result.data.hasMore));
        setOffset(offset + next.length);
        setSeedTotal(result.data.total ?? merged.length);
        if (result.data.seedOnly !== undefined) setSeedOnly(result.data.seedOnly !== false);
        refreshLocal(merged);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, source, offset, seed, refreshLocal, activeQuery]);

  const youRank = useMemo(() => {
    if (!local) return null;
    const idx = board.findIndex((e) => e.source === 'local' && e.handle === local.handle);
    return idx >= 0 ? idx + 1 : null;
  }, [board, local]);

  const filteredEmpty =
    !loading && Boolean(normalizeFameSearchQuery(activeQuery)) && seed.length === 0;

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

  const badgeLabel = loading
    ? 'loading board'
    : seedOnly
      ? source === 'api'
        ? 'seedOnly · api'
        : 'seedOnly · local'
      : source === 'api'
        ? 'api board'
        : 'local board';

  return (
    <div className="fame-board">
      <header className="fame-board__header">
        <div>
          <p className="section-kicker">Hall of Fame</p>
          <h1>Grind points. Claim the board.</h1>
        </div>
        <StatusBadge tone={source === 'api' ? 'pending' : 'degraded'}>{badgeLabel}</StatusBadge>
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

      <form
        className="fame-board__filter"
        role="search"
        aria-label="Filter seed Hall of Fame board"
        onSubmit={(e) => {
          e.preventDefault();
          setActiveQuery(queryInput.trim());
        }}
      >
        <label htmlFor="fame-board-q">
          Filter seed board
          <input
            id="fame-board-q"
            name="q"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="handle, name, or badge…"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            maxLength={64}
          />
        </label>
        {queryInput.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setQueryInput('');
              setActiveQuery('');
            }}
          >
            Clear
          </button>
        ) : null}
      </form>

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

      <p className="field-help" role="status">
        Seed rows loaded: {seed.length}
        {seedTotal > 0 ? ` / ${seedTotal}` : ''}
        {activeQuery.trim() ? ` · filter “${activeQuery.trim()}”` : ''}
        {seedOnly ? ' · seedOnly' : ''} (global multiplayer ledger: false)
      </p>

      <ol className="fame-board__list" aria-label="Hall of Fame leaderboard" aria-busy={loading}>
        {filteredEmpty ? (
          <li className="field-help" role="status">
            No seed ranks match “{activeQuery.trim()}”. This is not a live multiplayer search — try
            another handle, display name, or badge, or clear the filter.
          </li>
        ) : null}
        {!loading && !filteredEmpty && board.length === 0 ? (
          <li className="field-help" role="status">
            Board empty until seed fixtures or local grind points appear.
          </li>
        ) : null}
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

      {hasMore && source === 'api' ? (
        <p>
          <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Loading…' : 'Load more seed ranks'}
          </button>
        </p>
      ) : null}

      <p className="field-help">
        Board seed: <code>/api/v1/fame</code>
        {activeQuery.trim() ? (
          <>
            {' '}
            · <code>?q={activeQuery.trim()}</code>
          </>
        ) : null}{' '}
        (paginated, seedOnly). Push-record ledger (ops): GitHub branch <code>hall-of-fame</code> →{' '}
        <code>ops/hall-of-fame/counter.json</code>. Product points never invent ad revenue; practice
        pool funds local demo only.
      </p>
    </div>
  );
}
