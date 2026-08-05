/**
 * Product stories rail — pure, fixture-only story rings.
 * Never invents view counts, watchers, live viewers, or network-wide deletion.
 */

/** Abstract gradient tones only — no real story media bytes. */
export type StoryContentWarning = 'abstract-only' | 'adult-artistic' | 'adult-explicit';

/**
 * One synthetic story ring (owner + single abstract item).
 * Not a signed ephemeral object; not a live viewer rail.
 */
export interface SyntheticProductStory {
  readonly id: string;
  /** Handle without leading @ for stable JSON; UI may prefix. */
  readonly ownerHandle: string;
  readonly displayName: string;
  readonly title: string;
  /** ISO-8601 far-future expiry for demos — not a deletion guarantee. */
  readonly expiresAt: string;
  readonly contentWarning: StoryContentWarning;
  readonly toneA: string;
  readonly toneB: string;
  readonly href: string;
  readonly source: 'synthetic-catalog';
  readonly synthetic: true;
  /** View / watcher counts are never claimed on fixtures. */
  readonly viewCountClaimed: false;
  readonly viewCount: null;
  readonly watchers: null;
  /** Public network-wide purge is never promised. */
  readonly deletionGuaranteed: false;
  readonly publishLive: false;
  readonly mediaSrc: null;
}

/**
 * Tiny synthetic ring catalog for demos / client typing.
 * Not a live stories graph; not verified protocol objects.
 */
export const SYNTHETIC_PRODUCT_STORIES: readonly SyntheticProductStory[] = [
  {
    id: 'synth-story-neon-ring',
    ownerHandle: 'neonangel',
    displayName: 'Neon Angel',
    title: 'Neon ring (synthetic)',
    expiresAt: '2099-12-31T23:59:59.000Z',
    contentWarning: 'abstract-only',
    toneA: 'rgba(20, 216, 255, .9)',
    toneB: 'rgba(194, 49, 239, .75)',
    href: '/stories',
    source: 'synthetic-catalog',
    synthetic: true,
    viewCountClaimed: false,
    viewCount: null,
    watchers: null,
    deletionGuaranteed: false,
    publishLive: false,
    mediaSrc: null,
  },
  {
    id: 'synth-story-desk-pulse',
    ownerHandle: 'droolhouse',
    displayName: 'Drool House',
    title: 'Desk pulse (synthetic)',
    expiresAt: '2099-12-31T23:59:59.000Z',
    contentWarning: 'abstract-only',
    toneA: 'rgba(255, 155, 82, .88)',
    toneB: 'rgba(229, 47, 130, .7)',
    href: '/stories',
    source: 'synthetic-catalog',
    synthetic: true,
    viewCountClaimed: false,
    viewCount: null,
    watchers: null,
    deletionGuaranteed: false,
    publishLive: false,
    mediaSrc: null,
  },
  {
    id: 'synth-story-soft-edge',
    ownerHandle: 'softfocus',
    displayName: 'Soft Focus',
    title: 'Soft edge (synthetic)',
    expiresAt: '2099-12-31T23:59:59.000Z',
    contentWarning: 'abstract-only',
    toneA: 'rgba(66, 143, 255, .88)',
    toneB: 'rgba(245, 62, 188, .68)',
    href: '/stories',
    source: 'synthetic-catalog',
    synthetic: true,
    viewCountClaimed: false,
    viewCount: null,
    watchers: null,
    deletionGuaranteed: false,
    publishLive: false,
    mediaSrc: null,
  },
] as const;

/** @deprecated Prefer SYNTHETIC_PRODUCT_STORIES — kept for early call sites. */
export const PRODUCT_STORY_FIXTURES = SYNTHETIC_PRODUCT_STORIES;

/** @deprecated Prefer SyntheticProductStory. */
export type ProductStoryFixture = SyntheticProductStory;

export function pageSyntheticProductStories(options?: {
  readonly limit?: number;
  readonly offset?: number;
}): {
  readonly items: readonly SyntheticProductStory[];
  readonly count: number;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
  readonly empty: boolean;
  readonly configured: false;
  readonly syntheticOnly: true;
  readonly viewCountsInvented: false;
  readonly inventsViewCounts: false;
  readonly globalDeletionClaimed: false;
  readonly publishLive: false;
  readonly mediaPipelineLive: false;
} {
  const limit = Math.min(Math.max(1, options?.limit ?? 24), 48);
  const offset = Math.min(Math.max(0, options?.offset ?? 0), 10_000);
  const total = SYNTHETIC_PRODUCT_STORIES.length;
  const items = SYNTHETIC_PRODUCT_STORIES.slice(offset, offset + limit);
  return {
    items,
    count: items.length,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
    empty: items.length === 0,
    configured: false,
    syntheticOnly: true,
    viewCountsInvented: false,
    inventsViewCounts: false,
    globalDeletionClaimed: false,
    publishLive: false,
    mediaPipelineLive: false,
  };
}

/** @deprecated Prefer pageSyntheticProductStories. */
export function pageProductStories(options?: {
  readonly limit?: number;
  readonly offset?: number;
}) {
  return pageSyntheticProductStories(options);
}

/**
 * Honest stories product payload for GET /api/v1/stories.
 * Rail is synthetic rings only (or empty at high offset).
 * Never invents view counts, watchers, or network-wide deletion.
 * `items` and `stories` are the same list (alias for older clients).
 */
export function buildProductStoriesResponse(options?: {
  readonly limit?: number;
  readonly offset?: number;
}) {
  const page = pageSyntheticProductStories(options);
  const emptyNote =
    'No story rings in this page window. Empty is honest — not a silent live viewer rail. Fixtures are synthetic abstract rings only; real ephemeral media requires signed objects, expiry policy, and media-worker.';
  const fullNote =
    'Stories API returns tiny in-repo synthetic story rings only. View counts, watchers, and network-wide deletion are never invented. Publishing is not live on this route.';

  return {
    ok: true as const,
    product: 'wetdrool' as const,
    path: '/api/v1/stories' as const,
    items: page.items,
    stories: page.items,
    count: page.count,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    hasMore: page.hasMore,
    empty: page.empty,
    emptyMessage: page.empty ? emptyNote : null,
    configured: page.configured,
    syntheticOnly: page.syntheticOnly,
    viewCountsInvented: page.viewCountsInvented,
    inventsViewCounts: page.inventsViewCounts,
    globalDeletionClaimed: page.globalDeletionClaimed,
    publishLive: page.publishLive,
    mediaPipelineLive: page.mediaPipelineLive,
    media: 'synthetic-fixtures' as const,
    note: page.empty ? emptyNote : fullNote,
  };
}
