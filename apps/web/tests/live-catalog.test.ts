import { describe, expect, it } from 'vitest';

import {
  LIVE_ROOMS,
  filterLiveRooms,
  listLiveTags,
  normalizeLiveTag,
  pageLiveRooms,
} from '../lib/live-catalog';

describe('live catalog pagination', () => {
  it('pages full catalog with hasMore', () => {
    const page = pageLiveRooms(LIVE_ROOMS, { nsfwAllowed: true, limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(LIVE_ROOMS.length);
    expect(page.hasMore).toBe(LIVE_ROOMS.length > 2);
    expect(page.tag).toBeNull();
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

describe('live catalog tag filter', () => {
  it('normalizeLiveTag trims, lowercases, maps all/empty to null', () => {
    expect(normalizeLiveTag(null)).toBeNull();
    expect(normalizeLiveTag('')).toBeNull();
    expect(normalizeLiveTag('  all  ')).toBeNull();
    expect(normalizeLiveTag(' Pride ')).toBe('pride');
    expect(normalizeLiveTag('x'.repeat(40))).toHaveLength(32);
  });

  it('listLiveTags returns sorted unique fixture tags', () => {
    const tags = listLiveTags(LIVE_ROOMS);
    expect(tags).toEqual([...tags].sort((a, b) => a.localeCompare(b)));
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags).toContain('pride');
    expect(tags).toContain('dev');
  });

  it('filterLiveRooms matches exact tag case-insensitively', () => {
    const pride = filterLiveRooms(LIVE_ROOMS, { nsfwAllowed: true, tag: 'PRIDE' });
    expect(pride).toHaveLength(1);
    expect(pride[0]?.id).toBe('room-pride-desk');
    expect(pride[0]?.tags).toContain('pride');
  });

  it('pageLiveRooms applies tag before paging and echoes tag', () => {
    const page = pageLiveRooms(LIVE_ROOMS, {
      nsfwAllowed: true,
      tag: 'femboy',
      limit: 10,
      offset: 0,
    });
    expect(page.tag).toBe('femboy');
    expect(page.total).toBe(1);
    expect(page.items[0]?.id).toBe('room-femboy-lofi');
    expect(page.hasMore).toBe(false);
  });

  it('unknown tag yields empty page without inventing rooms', () => {
    const page = pageLiveRooms(LIVE_ROOMS, {
      nsfwAllowed: true,
      tag: 'not-a-real-tag',
      limit: 24,
      offset: 0,
    });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.tag).toBe('not-a-real-tag');
  });

  it('combines SFW and tag filters', () => {
    const page = pageLiveRooms(LIVE_ROOMS, {
      nsfwAllowed: false,
      tag: 'dev',
      limit: 24,
      offset: 0,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.nsfw).toBe(false);
    expect(page.items[0]?.tags).toContain('dev');
  });
});
