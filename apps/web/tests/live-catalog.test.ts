import { describe, expect, it } from 'vitest';

import { LIVE_ROOMS, pageLiveRooms } from '../lib/live-catalog';

describe('live catalog pagination', () => {
  it('pages full catalog with hasMore', () => {
    const page = pageLiveRooms(LIVE_ROOMS, { nsfwAllowed: true, limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(LIVE_ROOMS.length);
    expect(page.hasMore).toBe(LIVE_ROOMS.length > 2);
    const next = pageLiveRooms(LIVE_ROOMS, { nsfwAllowed: true, limit: 2, offset: 2 });
    expect(next.offset).toBe(2);
    expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
  });

  it('SFW filter reduces total without inventing rooms', () => {
    const page = pageLiveRooms(LIVE_ROOMS, { nsfwAllowed: false, limit: 24, offset: 0 });
    expect(page.items.every((r) => !r.nsfw)).toBe(true);
    expect(page.total).toBe(LIVE_ROOMS.filter((r) => !r.nsfw).length);
    expect(page.hasMore).toBe(false);
  });
});
