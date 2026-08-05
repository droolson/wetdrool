import { describe, expect, it } from 'vitest';

import { extractPhotosPayload, normalizeProductPhotos } from '../components/product-photos';
import type { PhotosApiResponse } from '../lib/product-client';

describe('normalizeProductPhotos', () => {
  it('returns empty for non-arrays', () => {
    expect(normalizeProductPhotos(null)).toEqual([]);
    expect(normalizeProductPhotos(undefined)).toEqual([]);
    expect(normalizeProductPhotos({})).toEqual([]);
    expect(normalizeProductPhotos('x')).toEqual([]);
  });

  it('drops malformed rows and never invents licensed media', () => {
    const items = normalizeProductPhotos([
      {
        id: '1',
        title: 'Hello',
        creator: '@a',
        alt: 'gradient',
        href: '/photos',
        source: 'synthetic-catalog',
        synthetic: true,
        licensedMedia: true, // forced closed
        mediaSrc: 'https://evil.example/img.jpg', // forced null
        uploadLive: true, // forced closed
        toneA: 'rgba(1,2,3,.9)',
        toneB: 'rgba(4,5,6,.7)',
      },
      { id: '', title: 'bad' },
      { title: 'no-id' },
      { id: '2', title: '' },
      null,
      42,
      {
        id: '3',
        title: 'Soft',
        creator: '@b',
        tags: ['synthetic', 1, 'ok'],
        nsfw: true,
        contentWarning: 'abstract-only',
      },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: '1',
      title: 'Hello',
      licensedMedia: false,
      mediaSrc: null,
      uploadLive: false,
      synthetic: true,
      toneA: 'rgba(1,2,3,.9)',
    });
    expect(items[1]).toMatchObject({
      id: '3',
      title: 'Soft',
      nsfw: true,
      contentWarning: 'abstract-only',
      tags: ['synthetic', 'ok'],
      licensedMedia: false,
      href: '/photos',
    });
  });

  it('preserves empty catalog without placeholders', () => {
    expect(normalizeProductPhotos([])).toEqual([]);
  });
});

describe('extractPhotosPayload', () => {
  it('prefers items and falls back to photos for lag', () => {
    const withItems = {
      ok: true as const,
      items: [{ id: 'a', title: 'A' }],
      photos: [{ id: 'b', title: 'B' }],
    } as unknown as PhotosApiResponse;
    expect(extractPhotosPayload(withItems)).toEqual([{ id: 'a', title: 'A' }]);

    const withPhotosOnly = {
      ok: true as const,
      photos: [{ id: 'b', title: 'B' }],
    } as unknown as PhotosApiResponse;
    expect(extractPhotosPayload(withPhotosOnly)).toEqual([{ id: 'b', title: 'B' }]);

    const empty = { ok: true as const } as PhotosApiResponse;
    expect(extractPhotosPayload(empty)).toEqual([]);
  });
});
