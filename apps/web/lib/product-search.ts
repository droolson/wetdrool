/**
 * Product synthetic search — fixture catalog only.
 * Not a global user/post index. Results are always labeled synthetic.
 */

import { listCreatorDirectory } from './creator-economy';
import { FAME_SEED } from './hall-of-fame';
import { LIVE_ROOMS } from './live-catalog';
import { SHORT_CLIPS } from './short-feed';

export type ProductSearchHitKind = 'short' | 'creator' | 'live' | 'fame';

export interface ProductSearchHit {
  readonly id: string;
  readonly kind: ProductSearchHitKind;
  readonly title: string;
  readonly subtitle: string;
  readonly href: string;
  readonly source: 'synthetic-catalog';
  readonly tags: readonly string[];
}

export function normalizeProductSearchQuery(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const q = raw.trim().toLowerCase().replace(/^@/, '');
  if (q.length === 0) return null;
  return q.slice(0, 64);
}

function includes(hay: string, q: string): boolean {
  return hay.toLowerCase().includes(q);
}

/**
 * Search in-repo synthetic fixtures only. Empty q → empty results (honest).
 * Cap hits so demos stay small; never invent real accounts.
 */
export function searchSyntheticCatalog(
  qRaw: string | null | undefined,
  options?: { readonly limit?: number },
): {
  readonly q: string | null;
  readonly results: readonly ProductSearchHit[];
  readonly total: number;
  readonly configured: false;
  readonly globalIndex: false;
  readonly syntheticOnly: true;
} {
  const q = normalizeProductSearchQuery(qRaw);
  const limit = Math.min(Math.max(1, options?.limit ?? 24), 48);
  if (!q) {
    return {
      q: null,
      results: [],
      total: 0,
      configured: false,
      globalIndex: false,
      syntheticOnly: true,
    };
  }

  const hits: ProductSearchHit[] = [];

  for (const clip of SHORT_CLIPS) {
    if (
      includes(clip.title, q) ||
      includes(clip.creator, q) ||
      includes(clip.category, q) ||
      includes(clip.id, q)
    ) {
      hits.push({
        id: `short:${clip.id}`,
        kind: 'short',
        title: clip.title,
        subtitle: `${clip.creator} · ${clip.category}`,
        href: '/video',
        source: 'synthetic-catalog',
        tags: [clip.mode, clip.category, 'synthetic'],
      });
    }
  }

  const creators = listCreatorDirectory({ limit: 48, offset: 0, q });
  for (const c of creators.items) {
    hits.push({
      id: `creator:${c.handle}`,
      kind: 'creator',
      title: c.displayName,
      subtitle: `@${c.handle}`,
      href: c.profilePath,
      source: 'synthetic-catalog',
      tags: [...c.tags, c.source],
    });
  }

  for (const room of LIVE_ROOMS) {
    if (
      includes(room.title, q) ||
      includes(room.host, q) ||
      includes(room.id, q) ||
      room.tags.some((t) => includes(t, q))
    ) {
      hits.push({
        id: `live:${room.id}`,
        kind: 'live',
        title: room.title,
        subtitle: `${room.host} · staged`,
        href: '/live',
        source: 'synthetic-catalog',
        tags: [...room.tags, 'live'],
      });
    }
  }

  for (const fame of FAME_SEED) {
    if (
      includes(fame.handle, q) ||
      includes(fame.displayName, q) ||
      fame.badges.some((b) => includes(b, q))
    ) {
      hits.push({
        id: `fame:${fame.handle}`,
        kind: 'fame',
        title: fame.displayName,
        subtitle: `@${fame.handle} · seed board`,
        href: '/fame',
        source: 'synthetic-catalog',
        tags: [...fame.badges, 'seed'],
      });
    }
  }

  // Dedupe by id (creator list may overlap shorts creators).
  const seen = new Set<string>();
  const unique = hits.filter((h) => {
    if (seen.has(h.id)) return false;
    seen.add(h.id);
    return true;
  });

  return {
    q,
    results: unique.slice(0, limit),
    total: unique.length,
    configured: false,
    globalIndex: false,
    syntheticOnly: true,
  };
}
