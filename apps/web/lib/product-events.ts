/**
 * Product events calendar helpers — pure, fixture-only.
 * Never invent live attendance, RSVP counts, or a global event directory.
 */

/** In-repo demo event for API shape only — not a live listing. */
export interface SyntheticProductEvent {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone: string;
  readonly href: string;
  readonly locationLabel: string;
  readonly source: 'synthetic-catalog';
  readonly synthetic: true;
  /** Attendance is never claimed for fixtures. */
  readonly attendanceClaimed: false;
  readonly liveAttendance: null;
  readonly rsvpOpen: false;
}

/**
 * Tiny synthetic catalog for demos / client typing.
 * Not a public calendar; not verified protocol events.
 */
export const SYNTHETIC_PRODUCT_EVENTS: readonly SyntheticProductEvent[] = [
  {
    id: 'synth-event-open-preview',
    title: 'WetDrool protocol preview (synthetic)',
    summary:
      'Fixture-only placeholder for product API shape. Not a real meetup, stream, or RSVP.',
    startsAt: '2099-01-15T18:00:00.000Z',
    endsAt: '2099-01-15T19:00:00.000Z',
    timezone: 'UTC',
    href: '/events',
    locationLabel: 'synthetic · no venue',
    source: 'synthetic-catalog',
    synthetic: true,
    attendanceClaimed: false,
    liveAttendance: null,
    rsvpOpen: false,
  },
  {
    id: 'synth-event-mesh-lab',
    title: 'Local mesh lab night (synthetic)',
    summary:
      'Illustrative second fixture. No tickets, no geolocation, no attendance projection.',
    startsAt: '2099-02-01T20:00:00.000Z',
    endsAt: '2099-02-01T22:00:00.000Z',
    timezone: 'UTC',
    href: '/events',
    locationLabel: 'synthetic · online-only label',
    source: 'synthetic-catalog',
    synthetic: true,
    attendanceClaimed: false,
    liveAttendance: null,
    rsvpOpen: false,
  },
] as const;

export function pageSyntheticProductEvents(options?: {
  readonly limit?: number;
  readonly offset?: number;
}): {
  readonly items: readonly SyntheticProductEvent[];
  readonly count: number;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
  readonly configured: false;
  readonly syntheticOnly: true;
  readonly globalCalendar: false;
  readonly inventsLiveAttendance: false;
  readonly attendanceProjection: false;
  readonly rsvpLive: false;
} {
  const limit = Math.min(Math.max(1, options?.limit ?? 24), 48);
  const offset = Math.min(Math.max(0, options?.offset ?? 0), 10_000);
  const total = SYNTHETIC_PRODUCT_EVENTS.length;
  const items = SYNTHETIC_PRODUCT_EVENTS.slice(offset, offset + limit);
  return {
    items,
    count: items.length,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
    configured: false,
    syntheticOnly: true,
    globalCalendar: false,
    inventsLiveAttendance: false,
    attendanceProjection: false,
    rsvpLive: false,
  };
}

/**
 * Honest events product payload for GET /api/v1/events.
 * Global calendar is unconfigured; page is synthetic fixtures only (or empty at high offset).
 */
export function buildProductEventsResponse(options?: {
  readonly limit?: number;
  readonly offset?: number;
}) {
  const page = pageSyntheticProductEvents(options);
  return {
    ok: true as const,
    product: 'wetdrool' as const,
    path: '/api/v1/events' as const,
    items: page.items,
    count: page.count,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    hasMore: page.hasMore,
    configured: page.configured,
    syntheticOnly: page.syntheticOnly,
    globalCalendar: page.globalCalendar,
    inventsLiveAttendance: page.inventsLiveAttendance,
    attendanceProjection: page.attendanceProjection,
    rsvpLive: page.rsvpLive,
    media: 'synthetic-fixtures' as const,
    note: 'Events API returns tiny in-repo synthetic fixtures only. Global events calendar is not configured. Live attendance, RSVP counts, and nearby discovery are never invented.',
  };
}
