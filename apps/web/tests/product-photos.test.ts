import { describe, expect, it } from 'vitest';

import {
  buildProductPhotosResponse,
  pageSyntheticProductPhotos,
  SYNTHETIC_PRODUCT_PHOTOS,
} from '../lib/product-photos';

describe('product-photos', () => {
  it('pages synthetic abstract fixtures only', () => {
    const page = pageSyntheticProductPhotos({ limit: 10, offset: 0 });
    expect(page.total).toBe(SYNTHETIC_PRODUCT_PHOTOS.length);
    expect(page.syntheticOnly).toBe(true);
    expect(page.licensedMedia).toBe(false);
    expect(page.inventsPerformerMedia).toBe(false);
    expect(page.items.every((p) => p.synthetic && p.licensedMedia === false)).toBe(true);
  });

  it('respects offset beyond catalog', () => {
    const page = pageSyntheticProductPhotos({ limit: 5, offset: 100 });
    expect(page.items).toHaveLength(0);
    expect(page.hasMore).toBe(false);
    expect(page.empty).toBe(true);
  });

  it('buildProductPhotosResponse is honest envelope', () => {
    const body = buildProductPhotosResponse({ limit: 1, offset: 0 });
    expect(body.ok).toBe(true);
    expect(body.photos).toHaveLength(1);
    expect(body.licensedMedia).toBe(false);
  });
});
