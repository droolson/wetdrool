/**
 * Product photo gallery helpers — pure, fixture-only.
 * Never invent real performer media, licensed stills, or a live media CDN.
 */

/** Content warning for gallery cards (abstract fixtures only today). */
export type PhotoContentWarning = 'abstract-only' | 'adult-artistic' | 'adult-explicit';

/** In-repo demo photo card for API shape only — not licensed performer media. */
export interface SyntheticProductPhoto {
  readonly id: string;
  readonly title: string;
  readonly creator: string;
  readonly alt: string;
  readonly tags: readonly string[];
  readonly nsfw: boolean;
  readonly contentWarning: PhotoContentWarning;
  /** CSS gradient tones only — no image bytes / CDN URLs. */
  readonly toneA: string;
  readonly toneB: string;
  readonly href: string;
  readonly source: 'synthetic-catalog';
  readonly synthetic: true;
  /** Licensed real media is never claimed for fixtures. */
  readonly licensedMedia: false;
  readonly mediaSrc: null;
  readonly uploadLive: false;
}

/**
 * Tiny synthetic catalog for demos / client typing.
 * Abstract gradient cards only — never real performer stills or scrapes.
 */
export const SYNTHETIC_PRODUCT_PHOTOS: readonly SyntheticProductPhoto[] = [
  {
    id: 'synth-photo-studio-signal',
    title: 'Studio signal (synthetic)',
    creator: '@neonangel',
    alt: 'Abstract cyan-to-violet gradient card — not a real photograph.',
    tags: ['synthetic', 'studio', 'abstract'],
    nsfw: false,
    contentWarning: 'abstract-only',
    toneA: 'rgba(20, 216, 255, .9)',
    toneB: 'rgba(194, 49, 239, .75)',
    href: '/photos',
    source: 'synthetic-catalog',
    synthetic: true,
    licensedMedia: false,
    mediaSrc: null,
    uploadLive: false,
  },
  {
    id: 'synth-photo-after-hours',
    title: 'After-hours frame (synthetic)',
    creator: '@nightshift',
    alt: 'Abstract amber-to-magenta gradient card — fixture placeholder only.',
    tags: ['synthetic', 'night', 'abstract'],
    nsfw: false,
    contentWarning: 'abstract-only',
    toneA: 'rgba(255, 155, 82, .88)',
    toneB: 'rgba(229, 47, 130, .7)',
    href: '/photos',
    source: 'synthetic-catalog',
    synthetic: true,
    licensedMedia: false,
    mediaSrc: null,
    uploadLive: false,
  },
  {
    id: 'synth-photo-soft-focus',
    title: 'Soft focus board (synthetic)',
    creator: '@softfocus',
    alt: 'Abstract blue-to-pink gradient card — no performer media.',
    tags: ['synthetic', 'soft', 'abstract'],
    nsfw: false,
    contentWarning: 'abstract-only',
    toneA: 'rgba(66, 143, 255, .88)',
    toneB: 'rgba(245, 62, 188, .68)',
    href: '/photos',
    source: 'synthetic-catalog',
    synthetic: true,
    licensedMedia: false,
    mediaSrc: null,
    uploadLive: false,
  },
] as const;

export function pageSyntheticProductPhotos(options?: {
  readonly limit?: number;
  readonly offset?: number;
}): {
  readonly items: readonly SyntheticProductPhoto[];
  readonly count: number;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
  readonly configured: false;
  readonly syntheticOnly: true;
  readonly licensedMedia: false;
  readonly inventsPerformerMedia: false;
  readonly mediaPipelineLive: false;
  readonly uploadLive: false;
  readonly empty: boolean;
} {
  const limit = Math.min(Math.max(1, options?.limit ?? 24), 48);
  const offset = Math.min(Math.max(0, options?.offset ?? 0), 10_000);
  const total = SYNTHETIC_PRODUCT_PHOTOS.length;
  const items = SYNTHETIC_PRODUCT_PHOTOS.slice(offset, offset + limit);
  return {
    items,
    count: items.length,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
    configured: false,
    syntheticOnly: true,
    licensedMedia: false,
    inventsPerformerMedia: false,
    mediaPipelineLive: false,
    uploadLive: false,
    empty: items.length === 0,
  };
}

/**
 * Honest photos product payload for GET /api/v1/photos.
 * Gallery is synthetic fixtures only (or empty at high offset).
 * Never invents licensed performer media or CDN image URLs.
 * `items` and `photos` are the same list (alias for older clients).
 */
export function buildProductPhotosResponse(options?: {
  readonly limit?: number;
  readonly offset?: number;
}) {
  const page = pageSyntheticProductPhotos(options);
  const emptyNote =
    'No photos in this page window. Empty is honest — not a silent licensed gallery. Fixtures are synthetic abstract cards only; real performer media requires age/consent, licensing, and media-worker.';
  const fullNote =
    'Photos API returns tiny in-repo synthetic abstract fixtures only. Licensed performer media is not available. Media pipeline / uploads are not live on this route. Never invents real stills, scrapes, or CDN image URLs.';

  return {
    ok: true as const,
    product: 'wetdrool' as const,
    path: '/api/v1/photos' as const,
    items: page.items,
    photos: page.items,
    count: page.count,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    hasMore: page.hasMore,
    empty: page.empty,
    emptyMessage: page.empty ? emptyNote : null,
    configured: page.configured,
    syntheticOnly: page.syntheticOnly,
    licensedMedia: page.licensedMedia,
    inventsPerformerMedia: page.inventsPerformerMedia,
    mediaPipelineLive: page.mediaPipelineLive,
    uploadLive: page.uploadLive,
    media: 'synthetic-fixtures' as const,
    note: page.empty ? emptyNote : fullNote,
  };
}
