/**
 * RedGIFs-class short feed: ranking + fixtures.
 *
 * Live alpha mostly uses synthetic, non-explicit cards. Founder-owned media
 * (e.g. CUMDUMP) may ship with a real mediaSrc when the operator owns the
 * rights. Third-party porn still requires performer age/consent records,
 * licensing, and takedown paths — never a random scrape API.
 */

export type DiscoveryMode = 'all' | 'straight' | 'pride';

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
   * Founder-owned drops set this false and provide mediaSrc.
   */
  readonly synthetic: boolean;
  readonly contentWarning: ShortContentWarning;
  /** Loopback/public path to playable media when not synthetic. */
  readonly mediaSrc?: string;
  /** Optional deep-link to a dedicated drop page. */
  readonly dropHref?: string;
}

/** Founder-owned music-video drop — rights held by WetDrool operator. */
export const CUMDUMP_MEDIA_SRC = '/media/cumdump.webm' as const;
export const CUMDUMP_DROP_HREF = '/video/cumdump' as const;

export const SHORT_CLIPS: readonly ShortClip[] = [
  {
    id: 'founder-cumdump',
    mode: 'straight',
    category: 'music-video',
    title: 'CUMDUMP · HAIL SATAN · EVIL',
    creator: '@wetdrool',
    durationSec: 180,
    provenance: 1,
    recency: 1,
    novelty: 0.99,
    engagement: 0.72,
    toneA: 'rgba(180, 0, 24, .95)',
    toneB: 'rgba(40, 0, 8, .9)',
    synthetic: false,
    contentWarning: 'adult-artistic',
    mediaSrc: CUMDUMP_MEDIA_SRC,
    dropHref: CUMDUMP_DROP_HREF,
  },
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
}

/**
 * DroolRank-lite for shorts (weights match wallet-alpha / vision doc).
 * 35% provenance · 20% recency · 20% novelty · 10% engagement(capped) · 15% mode
 */
export function scoreShort(item: ShortClip, mode: DiscoveryMode): number {
  const modeMatch = mode === 'all' ? 0.5 : item.mode === mode ? 1 : 0;
  const engagement = Math.min(item.engagement, 0.75);
  return (
    item.provenance * 0.35 +
    item.recency * 0.2 +
    item.novelty * 0.2 +
    engagement * 0.1 +
    modeMatch * 0.15
  );
}

export function rankShorts(mode: DiscoveryMode, limit = 24): readonly RankedShort[] {
  return SHORT_CLIPS.filter((item) => mode === 'all' || item.mode === mode)
    .map((item) => {
      const score = scoreShort(item, mode);
      const why = [
        `provenance ${(item.provenance * 100).toFixed(0)}%`,
        `recency ${(item.recency * 100).toFixed(0)}%`,
        mode === 'all' ? 'mode all' : item.mode === mode ? `mode ${mode}` : 'mode mismatch',
        item.synthetic ? 'synthetic fixture' : 'founder media',
      ];
      return { ...item, score, why };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export const DISCOVERY_MODE_KEY = 'wetdrool.discovery.mode';

export function readDiscoveryMode(storage: Pick<Storage, 'getItem'> | null): DiscoveryMode {
  if (!storage) return 'all';
  const raw = storage.getItem(DISCOVERY_MODE_KEY);
  if (raw === 'straight' || raw === 'pride' || raw === 'all') return raw;
  return 'all';
}

export function writeDiscoveryMode(
  storage: Pick<Storage, 'setItem'>,
  mode: DiscoveryMode,
): void {
  storage.setItem(DISCOVERY_MODE_KEY, mode);
}
