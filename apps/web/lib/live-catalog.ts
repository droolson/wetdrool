/**
 * Live room product catalog — shared by GET /api/v1/live and local fallback.
 * Join / SFU / tips stay staged until a reviewed media pipeline ships.
 */

export type LiveRoomStatus = 'staged';

/** Catalog-wide join capability. SFU not online — always disabled. */
export type LiveJoinStatus = 'disabled';

export const LIVE_JOIN_STATUS: LiveJoinStatus = 'disabled';

export interface LiveRoom {
  readonly id: string;
  readonly title: string;
  readonly host: string;
  readonly nsfw: boolean;
  readonly tags: readonly string[];
  readonly viewersHint: string;
  readonly status: LiveRoomStatus;
}

export const LIVE_ROOMS: readonly LiveRoom[] = [
  {
    id: 'room-pride-desk',
    title: 'Pride desk · soft stream',
    host: '@violetwave',
    nsfw: true,
    tags: ['pride', 'trans', 'chat'],
    viewersHint: 'staged',
    status: 'staged',
  },
  {
    id: 'room-femboy-lofi',
    title: 'Femboy lofi hours',
    host: '@neonangel',
    nsfw: true,
    tags: ['femboy', 'lofi', 'tips'],
    viewersHint: 'staged',
    status: 'staged',
  },
  {
    id: 'room-sfw-dev',
    title: 'Build-in-public (SFW)',
    host: '@droolhouse',
    nsfw: false,
    tags: ['sfw', 'dev', 'mesh'],
    viewersHint: 'staged',
    status: 'staged',
  },
  {
    id: 'room-straight-after',
    title: 'After dark lounge',
    host: '@nightshift',
    nsfw: true,
    tags: ['straight', 'lounge'],
    viewersHint: 'staged',
    status: 'staged',
  },
] as const;

/** Normalize tag query: trim, lower, empty → null. Max 32 chars. */
export function normalizeLiveTag(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim().toLowerCase();
  if (t.length === 0 || t === 'all') return null;
  return t.slice(0, 32);
}

/** Unique tags from a room list (sorted, lowercase as stored). */
export function listLiveTags(rooms: readonly LiveRoom[] = LIVE_ROOMS): readonly string[] {
  const set = new Set<string>();
  for (const room of rooms) {
    for (const tag of room.tags) {
      const n = tag.trim().toLowerCase();
      if (n) set.add(n);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function filterLiveRooms(
  rooms: readonly LiveRoom[],
  options: {
    readonly nsfwAllowed: boolean;
    /** Exact tag match after normalizeLiveTag (null = no tag filter). */
    readonly tag?: string | null;
  },
): readonly LiveRoom[] {
  const tag = normalizeLiveTag(options.tag ?? null);
  return rooms.filter((r) => {
    if (!options.nsfwAllowed && r.nsfw) return false;
    if (tag && !r.tags.some((t) => t.toLowerCase() === tag)) return false;
    return true;
  });
}

export interface LiveRoomsPage {
  readonly items: readonly LiveRoom[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
  /** Echo of normalized tag filter, or null when unfiltered. */
  readonly tag: string | null;
}

/**
 * Honest empty copy when the page has zero rooms.
 * Tag filters never invent matches; SFW-only is explicit.
 */
export function emptyLiveRoomsMessage(options: {
  readonly tag?: string | null;
  readonly nsfwAllowed?: boolean;
  readonly total: number;
}): string | null {
  if (options.total > 0) return null;
  const tag = normalizeLiveTag(options.tag ?? null);
  if (tag) {
    return `No live rooms match tag “${tag}”. Join stays disabled; catalog is synthetic fixtures only.`;
  }
  if (options.nsfwAllowed === false) {
    return 'No SFW live rooms in the synthetic catalog. Join stays disabled.';
  }
  return 'Live catalog empty. Join stays disabled; no invented rooms or viewer counts.';
}

/** Page the live catalog after optional SFW + tag filters. Synthetic fixtures only. */
export function pageLiveRooms(
  rooms: readonly LiveRoom[],
  options: {
    readonly nsfwAllowed: boolean;
    readonly tag?: string | null;
    readonly limit?: number;
    readonly offset?: number;
  },
): LiveRoomsPage {
  const tag = normalizeLiveTag(options.tag ?? null);
  const filtered = filterLiveRooms(rooms, {
    nsfwAllowed: options.nsfwAllowed,
    tag,
  });
  const limit = Math.min(Math.max(1, options.limit ?? 24), 48);
  const offset = Math.max(0, options.offset ?? 0);
  const items = filtered.slice(offset, offset + limit);
  return {
    items,
    total: filtered.length,
    limit,
    offset,
    hasMore: offset + items.length < filtered.length,
    tag,
  };
}
