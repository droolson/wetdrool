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
