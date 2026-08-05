/**
 * Decentralized creator (OnlyFans-class) offering model.
 * Settlement stays staged until $DROOL mint + recipient + entitlement proofs exist.
 */

import { DROOL_SYMBOL, getDroolTokenConfig } from './drool-token';
import { VANITY_MONTHLY_USD } from './points';
import { SHORT_CLIPS } from './short-feed';

export type OfferingKind = 'subscription' | 'ppv' | 'tip_jar' | 'live_ticket';

export interface CreatorOffering {
  readonly id: string;
  readonly kind: OfferingKind;
  readonly title: string;
  readonly priceUsd: number;
  readonly pricePoints: number;
  readonly acceptsDrool: boolean;
  readonly e2eeDelivery: boolean;
  readonly status: 'staged' | 'live';
  readonly detail: string;
}

export interface CreatorStudioProfile {
  readonly handle: string;
  readonly displayName: string;
  readonly pronouns: string;
  readonly bio: string;
  readonly tags: readonly string[];
  readonly offerings: readonly CreatorOffering[];
  readonly e2eeDms: true;
  readonly jurisdictionNote: string;
}

const POINTS_PER_USD = 100;

export function usdToPoints(usd: number): number {
  return Math.ceil(usd * POINTS_PER_USD);
}

/** Founder preview studio — owner-approved public copy only. */
export function getFounderStudio(): CreatorStudioProfile {
  const token = getDroolTokenConfig();
  return {
    handle: 'kingofqueens6ix',
    displayName: 'Alex Droolhouse',
    pronouns: 'it/its',
    bio: '24M · freak · founder preview. Decentralized creator surface — no fake checkout.',
    tags: ['femboy', 'queer', 'creator', 'web3'],
    e2eeDms: true,
    jurisdictionNote:
      'Operator vehicle: Swiss foundation (planned). Private E2EE delivery for paid objects when messaging mesh is wired. Not a claim that local criminal law does not apply.',
    offerings: [
      {
        id: 'sub-monthly',
        kind: 'subscription',
        title: 'Monthly access',
        priceUsd: 9.99,
        pricePoints: usdToPoints(9.99),
        acceptsDrool: token.status === 'live',
        e2eeDelivery: true,
        status: 'staged',
        detail: 'Subscriber feed + DM priority. Checkout staged until mint + recipient verified.',
      },
      {
        id: 'ppv-drop',
        kind: 'ppv',
        title: 'Encrypted drop',
        priceUsd: 14.99,
        pricePoints: usdToPoints(14.99),
        acceptsDrool: token.status === 'live',
        e2eeDelivery: true,
        status: 'staged',
        detail: 'Pay-per-view ciphertext unlock on authorized devices only.',
      },
      {
        id: 'tip-jar',
        kind: 'tip_jar',
        title: 'Tip jar',
        priceUsd: 5,
        pricePoints: usdToPoints(5),
        acceptsDrool: token.status === 'live',
        e2eeDelivery: false,
        status: 'staged',
        detail: `Tips in SOL/USDC/${DROOL_SYMBOL} when rails are live. Points tips subject to ad-revenue cap.`,
      },
      {
        id: 'live-ticket',
        kind: 'live_ticket',
        title: 'Live room ticket',
        priceUsd: 4.99,
        pricePoints: usdToPoints(4.99),
        acceptsDrool: token.status === 'live',
        e2eeDelivery: false,
        status: 'staged',
        detail: '18+ livestream access pass. Chat is moderated; private gifts stay client-encrypted when wired.',
      },
    ],
  };
}

export function proModeQuote(): { readonly monthlyUsd: number; readonly points: number; readonly perks: readonly string[] } {
  return {
    monthlyUsd: VANITY_MONTHLY_USD,
    points: usdToPoints(VANITY_MONTHLY_USD),
    perks: [
      'No ads in shorts + home',
      'Pride / Straight / All discovery modes unlocked cosmetics',
      'name.drool vanity rail when registry is live',
      'Higher live tip visibility',
    ],
  };
}

export function normalizeCreatorHandle(raw: string): string | null {
  const h = raw.trim().replace(/^@/, '').toLowerCase();
  if (h.length < 1 || h.length > 96) return null;
  if (!/^[a-z0-9][a-z0-9_-]{0,95}$/.test(h)) return null;
  return h;
}

/** Resolve public studio profile (founder fixture or staged placeholder). */
export function resolveCreatorProfile(handleRaw: string): CreatorStudioProfile | null {
  const normalized = normalizeCreatorHandle(handleRaw);
  if (!normalized) return null;
  const founder = getFounderStudio();
  if (normalized === founder.handle || normalized === 'kingofqueens6ix') {
    return founder;
  }
  // Prefer display names from short-feed fixtures when known.
  const clip = SHORT_CLIPS.find((c) => c.creator.replace(/^@/, '').toLowerCase() === normalized);
  const displayName = clip ? clip.creator.replace(/^@/, '') : normalized;
  return {
    // Handle is always the normalized id; display name may keep fixture casing.
    handle: normalized,
    displayName: displayName.slice(0, 96),
    pronouns: 'not set',
    bio: 'Creator surface awaiting signed profile + offerings.',
    tags: clip ? [clip.category, clip.mode] : [],
    e2eeDms: true,
    jurisdictionNote: founder.jurisdictionNote,
    offerings: founder.offerings.map((o) => ({ ...o, status: 'staged' as const })),
  };
}

export interface CreatorDirectoryEntry {
  readonly handle: string;
  readonly displayName: string;
  readonly tags: readonly string[];
  readonly source: 'founder' | 'synthetic-catalog';
  readonly profilePath: string;
}

/**
 * Public directory of known fixture creators (not a discovery of real users).
 * Honest: synthetic until signed portable profiles exist.
 */
/** Normalize free-text directory filter (handle/display/tags). Empty → null. */
export function normalizeCreatorSearchQuery(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const q = raw.trim().toLowerCase().replace(/^@/, '');
  if (q.length === 0) return null;
  // Cap noise; directory is synthetic and small.
  return q.slice(0, 64);
}

function creatorMatchesQuery(entry: CreatorDirectoryEntry, q: string): boolean {
  if (entry.handle.includes(q)) return true;
  if (entry.displayName.toLowerCase().includes(q)) return true;
  return entry.tags.some((t) => t.toLowerCase().includes(q));
}

export function listCreatorDirectory(options?: {
  readonly limit?: number;
  readonly offset?: number;
  /** Case-insensitive substring over handle, display name, and tags. */
  readonly q?: string | null;
}): {
  readonly items: readonly CreatorDirectoryEntry[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
  readonly synthetic: true;
  readonly q: string | null;
} {
  const limit = Math.min(Math.max(1, options?.limit ?? 24), 48);
  const offset = Math.max(0, options?.offset ?? 0);
  const q = normalizeCreatorSearchQuery(options?.q ?? null);
  const founder = getFounderStudio();
  const byHandle = new Map<string, CreatorDirectoryEntry>();

  byHandle.set(founder.handle, {
    handle: founder.handle,
    displayName: founder.displayName,
    tags: founder.tags,
    source: 'founder',
    profilePath: `/creator/${founder.handle}`,
  });

  for (const clip of SHORT_CLIPS) {
    const handle = clip.creator.replace(/^@/, '').toLowerCase();
    if (byHandle.has(handle)) continue;
    byHandle.set(handle, {
      handle,
      displayName: clip.creator.replace(/^@/, ''),
      tags: [clip.category, clip.mode],
      source: 'synthetic-catalog',
      profilePath: `/creator/${handle}`,
    });
  }

  let all = [...byHandle.values()].sort((a, b) => a.handle.localeCompare(b.handle));
  if (q) {
    all = all.filter((entry) => creatorMatchesQuery(entry, q));
  }
  const items = all.slice(offset, offset + limit);
  return {
    items,
    total: all.length,
    limit,
    offset,
    hasMore: offset + items.length < all.length,
    synthetic: true,
    q,
  };
}
