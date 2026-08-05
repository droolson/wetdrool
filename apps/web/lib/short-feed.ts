/**
 * RedGIFs-class short feed: ranking + fixtures.
 *
 * Live alpha uses synthetic, non-explicit cards only. Real media requires
 * performer age/consent records, licensing, and takedown paths — never a
 * random scrape API.
 */

export type DiscoveryMode = 'all' | 'straight' | 'pride';

/** Public sort over the same ranked catalog — not a personalized for-you feed. */
export type ShortSortMode = 'trending' | 'recent';

export type ShortContentWarning = 'abstract-only' | 'adult-artistic' | 'adult-explicit';

export interface ShortClip {
  readonly id: string;
  readonly mode: 'straight' | 'pride';
  readonly category: string;
  readonly title: string;
  readonly creator: string;
  readonly durationSec: number;
  readonly provenance: number;
  readonly recency: number;
  readonly novelty: number;
  readonly engagement: number;
  readonly toneA: string;
  readonly toneB: string;
  /**
   * True when the card is an abstract fixture (no real performer media).
   * Licensed creator media may set this false and provide mediaSrc.
   */
  readonly synthetic: boolean;
  readonly contentWarning: ShortContentWarning;
  /** Public path to playable media when not synthetic. */
  readonly mediaSrc?: string;
  /** Optional deep-link to a dedicated drop page. */
  readonly dropHref?: string;
}

export const SHORT_CLIPS: readonly ShortClip[] = [
  {
    id: 'pride-femboy-studio',
    mode: 'pride',
    category: 'femboy',
    title: 'Studio signal · soft light',
    creator: '@neonangel',
    durationSec: 18,
    provenance: 1,
    recency: 0.96,
    novelty: 0.92,
    engagement: 0.61,
    toneA: 'rgba(20, 216, 255, .9)',
    toneB: 'rgba(194, 49, 239, .75)',
    synthetic: true,
    contentWarning: 'abstract-only',
  },
  {
    id: 'straight-after-hours',
    mode: 'straight',
    category: 'amateur',
    title: 'After-hours drop',
    creator: '@nightshift',
    durationSec: 22,
    provenance: 1,
    recency: 0.91,
    novelty: 0.72,
    engagement: 0.74,
    toneA: 'rgba(255, 155, 82, .88)',
    toneB: 'rgba(229, 47, 130, .7)',
    synthetic: true,
    contentWarning: 'abstract-only',
  },
  {
    id: 'pride-trans-premiere',
    mode: 'pride',
    category: 'trans',
    title: 'Independent premiere',
    creator: '@violetwave',
    durationSec: 27,
    provenance: 1,
    recency: 0.84,
    novelty: 0.98,
    engagement: 0.53,
    toneA: 'rgba(113, 83, 255, .9)',
    toneB: 'rgba(255, 74, 192, .72)',
    synthetic: true,
    contentWarning: 'abstract-only',
  },
  {
    id: 'straight-couples',
    mode: 'straight',
    category: 'couples',
    title: 'Creator-owned set',
    creator: '@afterglow',
    durationSec: 31,
    provenance: 1,
    recency: 0.78,
    novelty: 0.7,
    engagement: 0.68,
    toneA: 'rgba(255, 182, 91, .85)',
    toneB: 'rgba(105, 82, 250, .7)',
    synthetic: true,
    contentWarning: 'abstract-only',
  },
  {
    id: 'pride-queer-collab',
    mode: 'pride',
    category: 'queer',
    title: 'Collab energy',
    creator: '@doublevision',
    durationSec: 16,
    provenance: 1,
    recency: 0.72,
    novelty: 0.89,
    engagement: 0.58,
    toneA: 'rgba(12, 205, 255, .85)',
    toneB: 'rgba(255, 167, 70, .68)',
    synthetic: true,
    contentWarning: 'abstract-only',
  },
  {
    id: 'straight-cosplay',
    mode: 'straight',
    category: 'cosplay',
    title: 'Midnight cosplay',
    creator: '@softfocus',
    durationSec: 24,
    provenance: 1,
    recency: 0.69,
    novelty: 0.87,
    engagement: 0.49,
    toneA: 'rgba(66, 143, 255, .88)',
    toneB: 'rgba(245, 62, 188, .68)',
    synthetic: true,
    contentWarning: 'abstract-only',
  },
  {
    id: 'pride-audio-visual',
    mode: 'pride',
    category: 'audio',
    title: 'Low-frequency visual',
    creator: '@lowfrequency',
    durationSec: 40,
    provenance: 1,
    recency: 0.63,
    novelty: 0.81,
    engagement: 0.44,
    toneA: 'rgba(142, 76, 255, .86)',
    toneB: 'rgba(22, 215, 204, .7)',
    synthetic: true,
    contentWarning: 'abstract-only',
  },
  {
    id: 'straight-solo',
    mode: 'straight',
    category: 'solo',
    title: 'Direct signal',
    creator: '@daybreak',
    durationSec: 19,
    provenance: 1,
    recency: 0.58,
    novelty: 0.76,
    engagement: 0.51,
    toneA: 'rgba(255, 116, 83, .86)',
    toneB: 'rgba(34, 177, 255, .65)',
    synthetic: true,
    contentWarning: 'abstract-only',
  },
];

export interface RankedShort extends ShortClip {
  readonly score: number;
  readonly why: readonly string[];
  readonly syntheticLabel: string;
}

/** Public ranking weights (DroolRank-lite). */
export const SHORT_RANK_WEIGHTS = {
  provenance: 0.35,
  recency: 0.2,
  novelty: 0.2,
  engagement: 0.1,
  mode: 0.15,
  engagementCap: 0.75,
} as const;

export interface RankShortsOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly category?: string | null;
  /** Default `trending` (DroolRank-lite score). `recent` sorts by recency signal only. */
  readonly sort?: ShortSortMode;
}

export interface RankShortsPage {
  readonly items: readonly RankedShort[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
  readonly mode: DiscoveryMode;
  readonly category: string | null;
  readonly sort: ShortSortMode;
  readonly syntheticCount: number;
  readonly licensedCount: number;
}

/** Explicit personalization status — never implied by ranked catalog order. */
export interface PersonalizationStatus {
  readonly configured: false;
  readonly mode: 'unconfigured';
  readonly note: string;
}

export function parseDiscoveryMode(raw: string | null | undefined): DiscoveryMode {
  if (raw === 'straight' || raw === 'pride' || raw === 'all') return raw;
  return 'all';
}

export function parseShortSortMode(raw: string | null | undefined): ShortSortMode {
  if (raw === 'recent' || raw === 'trending') return raw;
  return 'trending';
}

export function listShortCategories(): readonly string[] {
  const set = new Set<string>();
  for (const c of SHORT_CLIPS) set.add(c.category);
  return [...set].sort();
}

/** Default page size for shorts discovery UI (keeps hasMore honest with the fixture set). */
export const SHORTS_PAGE_SIZE = 6;

export function contentWarningLabel(warning: ShortContentWarning): string {
  switch (warning) {
    case 'abstract-only':
      return 'Synthetic abstract fixture — not real performer media';
    case 'adult-artistic':
      return 'Adult artistic media — licensed / consented path required';
    case 'adult-explicit':
      return 'Adult explicit media — age gate + consent records required';
    default:
      return 'Content warning unknown';
  }
}

/**
 * Badge copy for cards/API. Always distinguish fixtures from licensed media —
 * never imply real performers for synthetic rows.
 */
export function syntheticMediaLabel(item: Pick<ShortClip, 'synthetic' | 'contentWarning'>): string {
  if (item.synthetic || item.contentWarning === 'abstract-only') {
    return 'SYNTHETIC FIXTURE · abstract only';
  }
  return 'LICENSED MEDIA · consented';
}

/** Empty-state copy when a mode/category filter yields zero ranked items. */
export function emptyDiscoveryMessage(
  mode: DiscoveryMode,
  category: string | null | undefined,
): string {
  const cat = category?.trim().toLowerCase() || null;
  const catPart = cat && cat !== 'all' ? cat : null;
  if (catPart && mode !== 'all') {
    return `No shorts match mode “${mode}” and category “${catPart}”. Catalog is synthetic fixtures only — try All or another filter.`;
  }
  if (catPart) {
    return `No shorts in category “${catPart}”. The synthetic catalog is small; try All.`;
  }
  if (mode !== 'all') {
    return `No shorts for mode “${mode}” in the synthetic fixture set.`;
  }
  return 'No shorts available. Catalog is synthetic fixtures only until licensed media ships.';
}

/**
 * Honest personalization empty state — ranked catalogs are public recipes,
 * not a for-you / social-graph recommendation engine.
 */
export function personalizationUnconfiguredNote(): string {
  return (
    'Personalization is unconfigured: no follow-graph, watch history, or preference model is applied. ' +
    'This is a public DroolRank-lite / recency catalog, not a for-you feed.'
  );
}

export function personalizationStatus(): PersonalizationStatus {
  return {
    configured: false,
    mode: 'unconfigured',
    note: personalizationUnconfiguredNote(),
  };
}

export function shortSortLabel(sort: ShortSortMode): string {
  return sort === 'recent' ? 'Recent (recency signal)' : 'Trending (DroolRank-lite)';
}

/**
 * Arrow/Home/End navigation for chip toolbars and tablists.
 * Returns the next index, or null if the key is not a navigation key.
 */
export function chipKeyNavIndex(
  key: string,
  currentIndex: number,
  length: number,
): number | null {
  if (length <= 0) return null;
  const i = Math.max(0, Math.min(currentIndex, length - 1));
  if (key === 'ArrowRight' || key === 'ArrowDown') return (i + 1) % length;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (i - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}

/**
 * DroolRank-lite for shorts (weights match wallet-alpha / vision doc).
 * 35% provenance · 20% recency · 20% novelty · 10% engagement(capped) · 15% mode
 */
export function scoreShort(item: ShortClip, mode: DiscoveryMode): number {
  const modeMatch = mode === 'all' ? 0.5 : item.mode === mode ? 1 : 0;
  const engagement = Math.min(item.engagement, SHORT_RANK_WEIGHTS.engagementCap);
  return (
    item.provenance * SHORT_RANK_WEIGHTS.provenance +
    item.recency * SHORT_RANK_WEIGHTS.recency +
    item.novelty * SHORT_RANK_WEIGHTS.novelty +
    engagement * SHORT_RANK_WEIGHTS.engagement +
    modeMatch * SHORT_RANK_WEIGHTS.mode
  );
}

function rankAll(
  mode: DiscoveryMode,
  category?: string | null,
  sort: ShortSortMode = 'trending',
): RankedShort[] {
  const cat = category?.trim().toLowerCase() || null;
  const ranked = SHORT_CLIPS.filter((item) => mode === 'all' || item.mode === mode)
    .filter((item) => !cat || item.category === cat)
    .map((item) => {
      const score = scoreShort(item, mode);
      const why = [
        `provenance ${(item.provenance * 100).toFixed(0)}%`,
        `recency ${(item.recency * 100).toFixed(0)}%`,
        mode === 'all' ? 'mode all' : item.mode === mode ? `mode ${mode}` : 'mode mismatch',
        item.synthetic ? 'synthetic fixture' : 'licensed media',
        contentWarningLabel(item.contentWarning),
        sort === 'recent' ? 'sort recent' : 'sort trending',
      ];
      return {
        ...item,
        score,
        why,
        syntheticLabel: syntheticMediaLabel(item),
      };
    });

  if (sort === 'recent') {
    return ranked.sort(
      (a, b) => b.recency - a.recency || b.score - a.score || a.id.localeCompare(b.id),
    );
  }
  return ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Full ranked page with offset pagination. */
export function rankShortsPage(
  mode: DiscoveryMode,
  options: RankShortsOptions = {},
): RankShortsPage {
  const limit = Math.min(Math.max(1, options.limit ?? 24), 48);
  const offset = Math.max(0, options.offset ?? 0);
  const category = options.category?.trim().toLowerCase() || null;
  const sort = options.sort ?? 'trending';
  const ranked = rankAll(mode, category, sort);
  const items = ranked.slice(offset, offset + limit);
  const syntheticCount = items.filter((i) => i.synthetic).length;
  return {
    items,
    total: ranked.length,
    limit,
    offset,
    hasMore: offset + items.length < ranked.length,
    mode,
    category,
    sort,
    syntheticCount,
    licensedCount: items.length - syntheticCount,
  };
}

/** Backward-compatible helper used by UI fallbacks. */
export function rankShorts(mode: DiscoveryMode, limit = 24): readonly RankedShort[] {
  return rankShortsPage(mode, { limit, offset: 0 }).items;
}

export function rankingPolicyNote(): string {
  return (
    `DroolRank-lite weights: provenance ${SHORT_RANK_WEIGHTS.provenance}, ` +
    `recency ${SHORT_RANK_WEIGHTS.recency}, novelty ${SHORT_RANK_WEIGHTS.novelty}, ` +
    `engagement ${SHORT_RANK_WEIGHTS.engagement} (cap ${SHORT_RANK_WEIGHTS.engagementCap}), ` +
    `mode ${SHORT_RANK_WEIGHTS.mode}. Synthetic fixtures until licensed media pipeline.`
  );
}

/** Public honesty line for discovery surfaces and API notes. */
export function discoveryHonestyNote(allSynthetic: boolean): string {
  if (allSynthetic) {
    return 'Abstract synthetic fixtures only — labeled on purpose. No scraped adult APIs; licensed media requires consent + age records.';
  }
  return 'Mixed corpus: synthetic fixtures plus licensed media. Third-party adult media still needs consent + licensing.';
}

export const DISCOVERY_MODE_KEY = 'wetdrool.discovery.mode';

export function readDiscoveryMode(storage: Pick<Storage, 'getItem'> | null): DiscoveryMode {
  if (!storage) return 'all';
  return parseDiscoveryMode(storage.getItem(DISCOVERY_MODE_KEY));
}

export function writeDiscoveryMode(
  storage: Pick<Storage, 'setItem'>,
  mode: DiscoveryMode,
): void {
  storage.setItem(DISCOVERY_MODE_KEY, mode);
}
