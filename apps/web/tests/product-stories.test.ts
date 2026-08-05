import { describe, expect, it } from 'vitest';

import {
  pageSyntheticProductStories,
  SYNTHETIC_PRODUCT_STORIES,
} from '../lib/product-stories';

describe('product-stories', () => {
  it('never invents view counts or deletion guarantees', () => {
    const page = pageSyntheticProductStories({ limit: 10, offset: 0 });
    expect(page.total).toBe(SYNTHETIC_PRODUCT_STORIES.length);
    expect(page.viewCountsInvented).toBe(false);
    expect(page.globalDeletionClaimed).toBe(false);
    expect(page.items.every((s) => s.viewCountClaimed === false)).toBe(true);
    expect(page.items.every((s) => s.deletionGuaranteed === false)).toBe(true);
  });
});
