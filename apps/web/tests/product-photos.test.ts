import { describe, expect, it } from 'vitest';

import {
  SYNTHETIC_PRODUCT_PHOTOS,
  buildProductPhotosResponse,
  pageSyntheticProductPhotos,
} from '../lib/product-photos';

describe('product photos helpers', () => {
  it('synthetic catalog is non-empty and never claims licensed media', () => {
    expect(SYNTHETIC_PRODUCT_PHOTOS.length).toBeGreaterThan(0);
    for (const photo of SYNTHETIC_PRODUCT_PHOTOS) {
      expect(photo.synthetic).toBe(true);
      expect(photo.licensedMedia).toBe(false);
      expect(photo.mediaSrc).toBeNull();
      expect(photo.uploadLive).toBe(false);
      expect(photo.source).toBe('synthetic-catalog');
      expect(photo.contentWarning).toBe('abstract-only');
      expect(photo.href).toBe('/photos');
      // No CDN / real media URLs on fixtures.
      expect(photo.toneA.startsWith('rgba')).toBe(true);
      expect(photo.toneB.startsWith('rgba')).toBe(true);
    }
  });

  it('pages fixtures with hasMore and honest empty trailing offset', () => {
    const first = pageSyntheticProductPhotos({ limit: 1, offset: 0 });
    expect(first.items).toHaveLength(1);
    expect(first.count).toBe(1);
    expect(first.offset).toBe(0);
    expect(first.limit).toBe(1);
    expect(first.total).toBe(SYNTHETIC_PRODUCT_PHOTOS.length);
    expect(first.hasMore).toBe(first.total > 1);
    expect(first.configured).toBe(false);
    expect(first.syntheticOnly).toBe(true);
    expect(first.licensedMedia).toBe(false);
    expect(first.inventsPerformerMedia).toBe(false);
    expect(first.mediaPipelineLive).toBe(false);
    expect(first.uploadLive).toBe(false);
    expect(first.empty).toBe(false);

    const mid = pageSyntheticProductPhotos({ limit: 1, offset: 1 });
    expect(mid.items).toHaveLength(1);
    expect(mid.items[0]!.id).not.toBe(first.items[0]!.id);
    expect(mid.offset).toBe(1);

    const pastEnd = pageSyntheticProductPhotos({
      limit: 10,
      offset: SYNTHETIC_PRODUCT_PHOTOS.length,
    });
    expect(pastEnd.items).toHaveLength(0);
    expect(pastEnd.count).toBe(0);
    expect(pastEnd.hasMore).toBe(false);
    expect(pastEnd.empty).toBe(true);
    expect(pastEnd.total).toBe(SYNTHETIC_PRODUCT_PHOTOS.length);
    expect(pastEnd.syntheticOnly).toBe(true);
    expect(pastEnd.licensedMedia).toBe(false);
  });

  it('clamps limit/offset to safe bounds', () => {
    const clamped = pageSyntheticProductPhotos({ limit: 999, offset: -5 });
    expect(clamped.limit).toBe(48);
    expect(clamped.offset).toBe(0);
    const zeroish = pageSyntheticProductPhotos({ limit: 0, offset: 0 });
    expect(zeroish.limit).toBe(1);
  });

  it('buildProductPhotosResponse is synthetic-only with photos alias', () => {
    const body = buildProductPhotosResponse({ limit: 2, offset: 0 });
    expect(body.ok).toBe(true);
    expect(body.product).toBe('wetdrool');
    expect(body.path).toBe('/api/v1/photos');
    expect(body.configured).toBe(false);
    expect(body.syntheticOnly).toBe(true);
    expect(body.licensedMedia).toBe(false);
    expect(body.inventsPerformerMedia).toBe(false);
    expect(body.mediaPipelineLive).toBe(false);
    expect(body.uploadLive).toBe(false);
    expect(body.media).toBe('synthetic-fixtures');
    expect(body.empty).toBe(false);
    expect(body.emptyMessage).toBeNull();
    expect(body.items).toHaveLength(2);
    expect(body.photos).toEqual(body.items);
    expect(body.items.every((p) => p.synthetic === true)).toBe(true);
    expect(body.items.every((p) => p.licensedMedia === false)).toBe(true);
    expect(body.items.every((p) => p.mediaSrc === null)).toBe(true);
    expect(body.note.toLowerCase()).toMatch(/synthetic|licensed/);

    const empty = buildProductPhotosResponse({
      limit: 10,
      offset: SYNTHETIC_PRODUCT_PHOTOS.length + 5,
    });
    expect(empty.empty).toBe(true);
    expect(empty.items).toHaveLength(0);
    expect(empty.photos).toHaveLength(0);
    expect(empty.emptyMessage).not.toBeNull();
    expect(empty.note.toLowerCase()).toMatch(/empty|honest/);
    expect(empty.syntheticOnly).toBe(true);
    expect(empty.licensedMedia).toBe(false);
  });
});
