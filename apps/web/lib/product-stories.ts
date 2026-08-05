/**
 * Product stories rail — synthetic ephemeral fixtures only.
 * Never invents view counts, watchers, or deletion guarantees.
 */

export interface ProductStoryFixture {
  readonly id: string;
  readonly ownerHandle: string;
  readonly title: string;
  readonly expiresAt: string;
  readonly synthetic: true;
  readonly viewCountClaimed: false;
  readonly deletionGuaranteed: false;
  readonly href: string;
}

export const PRODUCT_STORY_FIXTURES: readonly ProductStoryFixture[] = [
  {
    id: 'story-neon-ring',
    ownerHandle: 'neonangel',
    title: 'Neon ring (synthetic)',
    expiresAt: '2099-12-31T23:59:59.000Z',
    synthetic: true,
    viewCountClaimed: false,
    deletionGuaranteed: false,
    href: '/stories',
  },
  {
    id: 'story-desk-pulse',
    ownerHandle: 'droolhouse',
    title: 'Desk pulse (synthetic)',
    expiresAt: '2099-12-31T23:59:59.000Z',
    synthetic: true,
    viewCountClaimed: false,
    deletionGuaranteed: false,
    href: '/stories',
  },
] as const;

export function pageProductStories(options?: {
  readonly limit?: number;
  readonly offset?: number;
}): {
  readonly items: readonly ProductStoryFixture[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
  readonly syntheticOnly: true;
  readonly viewCountsInvented: false;
  readonly globalDeletionClaimed: false;
} {
  const limit = Math.min(Math.max(1, options?.limit ?? 24), 48);
  const offset = Math.max(0, options?.offset ?? 0);
  const total = PRODUCT_STORY_FIXTURES.length;
  const items = PRODUCT_STORY_FIXTURES.slice(offset, offset + limit);
  return {
    items,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
    syntheticOnly: true,
    viewCountsInvented: false,
    globalDeletionClaimed: false,
  };
}
