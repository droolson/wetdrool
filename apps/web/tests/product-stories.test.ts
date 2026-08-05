import { describe, expect, it } from 'vitest';

import {
  SYNTHETIC_PRODUCT_STORIES,
  buildProductStoriesResponse,
  pageSyntheticProductStories,
} from '../lib/product-stories';

describe('product stories helpers', () => {
  it('synthetic catalog is non-empty and never invents views or deletion', () => {
    expect(SYNTHETIC_PRODUCT_STORIES.length).toBeGreaterThan(0);
    for (const story of SYNTHETIC_PRODUCT_STORIES) {
      expect(story.synthetic).toBe(true);
      expect(story.viewCountClaimed).toBe(false);
      expect(story.viewCount).toBeNull();
      expect(story.deletionGuaranteed).toBe(false);
    }
  });

  it('pages and builds honest response', () => {
    const page = pageSyntheticProductStories({ limit: 10, offset: 0 });
    expect(page.viewCountsInvented).toBe(false);
    expect(page.globalDeletionClaimed).toBe(false);
    const body = buildProductStoriesResponse({ limit: 1, offset: 0 });
    expect(body.ok).toBe(true);
    expect(body.stories).toHaveLength(1);
  });
});
