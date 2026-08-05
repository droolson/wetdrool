import { describe, expect, it } from 'vitest';

import {
  SYNTHETIC_PRODUCT_STORIES,
  buildProductStoriesResponse,
  pageProductStories,
  pageSyntheticProductStories,
} from '../lib/product-stories';
import { methodNotAllowed } from '../lib/product-api';

describe('product stories helpers', () => {
  it('synthetic catalog is non-empty and never invents views or deletion', () => {
    expect(SYNTHETIC_PRODUCT_STORIES.length).toBeGreaterThan(0);
    for (const story of SYNTHETIC_PRODUCT_STORIES) {
      expect(story.synthetic).toBe(true);
      expect(story.viewCountClaimed).toBe(false);
      expect(story.viewCount).toBeNull();
      expect(story.watchers).toBeNull();
      expect(story.deletionGuaranteed).toBe(false);
      expect(story.publishLive).toBe(false);
      expect(story.mediaSrc).toBeNull();
      expect(story.source).toBe('synthetic-catalog');
      expect(story.contentWarning).toBe('abstract-only');
      expect(story.href).toBe('/stories');
      expect(story.toneA.startsWith('rgba')).toBe(true);
      expect(story.toneB.startsWith('rgba')).toBe(true);
      expect(story).not.toHaveProperty('views');
      expect(story).not.toHaveProperty('viewerCount');
    }
  });

  it('pages rings with hasMore and honest empty trailing offset', () => {
    const first = pageSyntheticProductStories({ limit: 1, offset: 0 });
    expect(first.items).toHaveLength(1);
    expect(first.count).toBe(1);
    expect(first.offset).toBe(0);
    expect(first.limit).toBe(1);
    expect(first.total).toBe(SYNTHETIC_PRODUCT_STORIES.length);
    expect(first.hasMore).toBe(first.total > 1);
    expect(first.configured).toBe(false);
    expect(first.syntheticOnly).toBe(true);
    expect(first.viewCountsInvented).toBe(false);
    expect(first.inventsViewCounts).toBe(false);
    expect(first.globalDeletionClaimed).toBe(false);
    expect(first.publishLive).toBe(false);
    expect(first.mediaPipelineLive).toBe(false);
    expect(first.empty).toBe(false);

    const mid = pageSyntheticProductStories({ limit: 1, offset: 1 });
    expect(mid.items).toHaveLength(1);
    expect(mid.items[0]!.id).not.toBe(first.items[0]!.id);
    expect(mid.offset).toBe(1);

    const pastEnd = pageSyntheticProductStories({
      limit: 10,
      offset: SYNTHETIC_PRODUCT_STORIES.length,
    });
    expect(pastEnd.items).toHaveLength(0);
    expect(pastEnd.count).toBe(0);
    expect(pastEnd.hasMore).toBe(false);
    expect(pastEnd.empty).toBe(true);
    expect(pastEnd.total).toBe(SYNTHETIC_PRODUCT_STORIES.length);
    expect(pastEnd.syntheticOnly).toBe(true);
    expect(pastEnd.viewCountsInvented).toBe(false);
  });

  it('pageProductStories aliases pageSyntheticProductStories', () => {
    const a = pageProductStories({ limit: 2, offset: 0 });
    const b = pageSyntheticProductStories({ limit: 2, offset: 0 });
    expect(a.items).toEqual(b.items);
    expect(a.syntheticOnly).toBe(true);
  });

  it('clamps limit/offset to safe bounds', () => {
    const clamped = pageSyntheticProductStories({ limit: 999, offset: -5 });
    expect(clamped.limit).toBe(48);
    expect(clamped.offset).toBe(0);
    const zeroish = pageSyntheticProductStories({ limit: 0, offset: 0 });
    expect(zeroish.limit).toBe(1);
  });

  it('buildProductStoriesResponse is synthetic-only with stories alias', () => {
    const body = buildProductStoriesResponse({ limit: 2, offset: 0 });
    expect(body.ok).toBe(true);
    expect(body.product).toBe('wetdrool');
    expect(body.path).toBe('/api/v1/stories');
    expect(body.configured).toBe(false);
    expect(body.syntheticOnly).toBe(true);
    expect(body.viewCountsInvented).toBe(false);
    expect(body.inventsViewCounts).toBe(false);
    expect(body.globalDeletionClaimed).toBe(false);
    expect(body.publishLive).toBe(false);
    expect(body.mediaPipelineLive).toBe(false);
    expect(body.media).toBe('synthetic-fixtures');
    expect(body.empty).toBe(false);
    expect(body.emptyMessage).toBeNull();
    expect(body.items).toHaveLength(2);
    expect(body.stories).toEqual(body.items);
    expect(body.items.every((s) => s.synthetic === true)).toBe(true);
    expect(body.items.every((s) => s.viewCountClaimed === false)).toBe(true);
    expect(body.items.every((s) => s.viewCount === null)).toBe(true);
    expect(body.note.toLowerCase()).toMatch(/synthetic|view/);

    const empty = buildProductStoriesResponse({
      limit: 10,
      offset: SYNTHETIC_PRODUCT_STORIES.length + 5,
    });
    expect(empty.empty).toBe(true);
    expect(empty.items).toHaveLength(0);
    expect(empty.stories).toHaveLength(0);
    expect(empty.emptyMessage).not.toBeNull();
    expect(empty.note.toLowerCase()).toMatch(/empty|honest/);
    expect(empty.syntheticOnly).toBe(true);
    expect(empty.viewCountsInvented).toBe(false);
  });

  it('POST stories is method-not-allowed (405 Allow GET)', async () => {
    const post = methodNotAllowed(
      'GET',
      'Use GET for product stories. Publishing stories is not implemented here.',
    );
    expect(post.status).toBe(405);
    expect(post.headers.get('Allow')).toBe('GET');
    const err = (await post.json()) as {
      ok: false;
      error: { code: string };
    };
    expect(err.ok).toBe(false);
    expect(err.error.code).toBe('method_not_allowed');
  });
});
