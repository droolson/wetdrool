import { describe, expect, it } from 'vitest';

import { extractStoriesPayload, normalizeProductStories } from '../components/product-stories';
import type { StoriesApiResponse } from '../lib/product-client';

describe('normalizeProductStories', () => {
  it('returns empty for non-arrays', () => {
    expect(normalizeProductStories(null)).toEqual([]);
    expect(normalizeProductStories(undefined)).toEqual([]);
    expect(normalizeProductStories({})).toEqual([]);
    expect(normalizeProductStories('x')).toEqual([]);
  });

  it('drops malformed rows and never invents view counts or deletion', () => {
    const items = normalizeProductStories([
      {
        id: '1',
        title: 'Hello',
        ownerHandle: 'neon',
        expiresAt: '2099-01-01T00:00:00.000Z',
        href: '/stories',
        synthetic: true,
        viewCountClaimed: true, // forced closed
        deletionGuaranteed: true, // forced closed
      },
      { id: '', title: 'bad' },
      { title: 'no-id' },
      { id: '2', title: '' },
      null,
      42,
      {
        id: '3',
        title: 'Desk',
        ownerHandle: 'droolhouse',
        expiresAt: '2099-02-01T20:00:00.000Z',
      },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: '1',
      title: 'Hello',
      viewCountClaimed: false,
      deletionGuaranteed: false,
      synthetic: true,
    });
    expect(items[1]).toMatchObject({
      id: '3',
      title: 'Desk',
      ownerHandle: 'droolhouse',
      href: '/stories',
      viewCountClaimed: false,
      deletionGuaranteed: false,
    });
  });

  it('preserves empty catalog without placeholders', () => {
    expect(normalizeProductStories([])).toEqual([]);
  });
});

describe('extractStoriesPayload', () => {
  it('prefers stories and falls back to items for lag', () => {
    const withStories = {
      ok: true as const,
      stories: [{ id: 'a', title: 'A' }],
      items: [{ id: 'b', title: 'B' }],
    } as unknown as StoriesApiResponse;
    expect(extractStoriesPayload(withStories)).toEqual([{ id: 'a', title: 'A' }]);

    const withItemsOnly = {
      ok: true as const,
      items: [{ id: 'b', title: 'B' }],
    } as unknown as StoriesApiResponse;
    expect(extractStoriesPayload(withItemsOnly)).toEqual([{ id: 'b', title: 'B' }]);

    const empty = { ok: true as const } as StoriesApiResponse;
    expect(extractStoriesPayload(empty)).toEqual([]);
  });
});
