/**
 * Live room product catalog — shared by GET /api/v1/live and local fallback.
 * Join / SFU / tips stay staged until a reviewed media pipeline ships.
 */

export type LiveRoomStatus = 'staged';

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

export function filterLiveRooms(
  rooms: readonly LiveRoom[],
  options: { readonly nsfwAllowed: boolean },
): readonly LiveRoom[] {
  return rooms.filter((r) => (options.nsfwAllowed ? true : !r.nsfw));
}

export interface LiveRoomsPage {
  readonly items: readonly LiveRoom[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

/** Page the live catalog after optional SFW filter. Synthetic fixtures only. */
export function pageLiveRooms(
  rooms: readonly LiveRoom[],
  options: {
    readonly nsfwAllowed: boolean;
    readonly limit?: number;
    readonly offset?: number;
  },
): LiveRoomsPage {
  const filtered = filterLiveRooms(rooms, { nsfwAllowed: options.nsfwAllowed });
  const limit = Math.min(Math.max(1, options.limit ?? 24), 48);
  const offset = Math.max(0, options.offset ?? 0);
  const items = filtered.slice(offset, offset + limit);
  return {
    items,
    total: filtered.length,
    limit,
    offset,
    hasMore: offset + items.length < filtered.length,
  };
}
