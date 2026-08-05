/**
 * Hall of Fame — local + static leaderboard for points gamification.
 * Device-local entries are optional; seed board is public product fixtures.
 */

export const HOF_LOCAL_KEY = 'wetdrool.hallOfFame.local.v1';

export interface FameEntry {
  readonly handle: string;
  readonly displayName: string;
  readonly lifetimePoints: number;
  readonly streakDays: number;
  readonly badges: readonly string[];
  readonly source: 'seed' | 'local';
}

export interface LocalFameProfile {
  readonly version: 1;
  readonly handle: string;
  readonly displayName: string;
  readonly lifetimePoints: number;
  readonly checkinDays: readonly string[];
  readonly updatedAt: string;
}

/** Public seed board (not paid placement). */
export const FAME_SEED: readonly FameEntry[] = [
  {
    handle: 'kingofqueens6ix',
    displayName: 'Alex Droolhouse',
    lifetimePoints: 42069,
    streakDays: 7,
    badges: ['founder', 'freak', 'builder'],
    source: 'seed',
  },
  {
    handle: 'neonangel',
    displayName: 'Neon Angel',
    lifetimePoints: 12800,
    streakDays: 12,
    badges: ['shorts', 'pride'],
    source: 'seed',
  },
  {
    handle: 'violetwave',
    displayName: 'Violet Wave',
    lifetimePoints: 9600,
    streakDays: 5,
    badges: ['live', 'creator'],
    source: 'seed',
  },
  {
    handle: 'nightshift',
    displayName: 'Night Shift',
    lifetimePoints: 7400,
    streakDays: 3,
    badges: ['hub'],
    source: 'seed',
  },
  {
    handle: 'afterglow',
    displayName: 'Afterglow',
    lifetimePoints: 5100,
    streakDays: 2,
    badges: ['couples'],
    source: 'seed',
  },
] as const;

export function emptyLocalProfile(): LocalFameProfile {
  return {
    version: 1,
    handle: 'you',
    displayName: 'You',
    lifetimePoints: 0,
    checkinDays: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function loadLocalFame(storage: Pick<Storage, 'getItem'> | null): LocalFameProfile {
  if (!storage) return emptyLocalProfile();
  try {
    const raw = storage.getItem(HOF_LOCAL_KEY);
    if (!raw) return emptyLocalProfile();
    const parsed = JSON.parse(raw) as Partial<LocalFameProfile>;
    if (parsed.version !== 1) return emptyLocalProfile();
    return {
      version: 1,
      handle: typeof parsed.handle === 'string' && parsed.handle ? parsed.handle : 'you',
      displayName:
        typeof parsed.displayName === 'string' && parsed.displayName
          ? parsed.displayName
          : 'You',
      lifetimePoints: Math.max(0, Number(parsed.lifetimePoints) || 0),
      checkinDays: Array.isArray(parsed.checkinDays)
        ? parsed.checkinDays.filter((d): d is string => typeof d === 'string').slice(-400)
        : [],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return emptyLocalProfile();
  }
}

export function saveLocalFame(
  storage: Pick<Storage, 'setItem'>,
  profile: LocalFameProfile,
): void {
  storage.setItem(HOF_LOCAL_KEY, JSON.stringify(profile));
}

/** Sync local fame from points ledger lifetime + optional check-in day. */
export function syncLocalFameFromPoints(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  lifetimePoints: number,
  checkinDay: string | null,
  handle = 'you',
  displayName = 'You',
): LocalFameProfile {
  const prev = loadLocalFame(storage);
  const days = new Set(prev.checkinDays);
  if (checkinDay) days.add(checkinDay);
  const checkinDays = [...days].sort();
  const next: LocalFameProfile = {
    version: 1,
    handle: handle.slice(0, 32),
    displayName: displayName.slice(0, 64),
    lifetimePoints: Math.max(prev.lifetimePoints, lifetimePoints),
    checkinDays,
    updatedAt: new Date().toISOString(),
  };
  saveLocalFame(storage, next);
  return next;
}

export function streakFromDays(days: readonly string[], todayUtc: string): number {
  if (days.length === 0) return 0;
  const set = new Set(days);
  let streak = 0;
  let cursor = todayUtc;
  while (set.has(cursor)) {
    streak += 1;
    const d = new Date(`${cursor}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    cursor = d.toISOString().slice(0, 10);
  }
  return streak;
}

/**
 * Rank a seed board (API or static fixtures) with an optional local grinder row.
 * Seed rows with source 'local' are dropped so the browser profile is authoritative.
 */
export function rankBoardWithSeed(
  seed: readonly FameEntry[],
  local: LocalFameProfile | null,
  todayUtc: string,
): readonly FameEntry[] {
  const entries: FameEntry[] = seed
    .filter((e) => e.source !== 'local')
    .map((e) => ({
      handle: e.handle,
      displayName: e.displayName,
      lifetimePoints: e.lifetimePoints,
      streakDays: e.streakDays,
      badges: e.badges,
      source: e.source === 'seed' ? ('seed' as const) : ('seed' as const),
    }));
  if (local && local.lifetimePoints > 0) {
    entries.push({
      handle: local.handle,
      displayName: local.displayName,
      lifetimePoints: local.lifetimePoints,
      streakDays: streakFromDays(local.checkinDays, todayUtc),
      badges: ['local', 'grinder'],
      source: 'local',
    });
  }
  return [...entries].sort((a, b) => b.lifetimePoints - a.lifetimePoints);
}

export function rankBoard(local: LocalFameProfile | null, todayUtc: string): readonly FameEntry[] {
  return rankBoardWithSeed(FAME_SEED, local, todayUtc);
}

export function fameTier(lifetimePoints: number): string {
  if (lifetimePoints >= 50000) return 'Mythic';
  if (lifetimePoints >= 20000) return 'Legend';
  if (lifetimePoints >= 10000) return 'Diamond';
  if (lifetimePoints >= 5000) return 'Gold';
  if (lifetimePoints >= 1000) return 'Silver';
  if (lifetimePoints >= 100) return 'Bronze';
  return 'New blood';
}
