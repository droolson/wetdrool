import type { Metadata } from 'next';

import { FeedSurface } from '@/components/feed-surface';

export const metadata: Metadata = {
  title: 'Trending feed',
  description: 'Transparent trend discovery awaiting an explainable feed provider.',
};

export default function TrendingFeedPage() {
  return (
    <FeedSurface
      contract={[
        { label: 'Window', value: 'Explicit time range and eligible population' },
        { label: 'Score', value: 'Published boosts, penalties, and abuse resistance' },
        { label: 'Explanation', value: 'Per-item reason and provider identity' },
      ]}
      detail="Trending can amplify a community quickly, so its window, population, anti-manipulation rules, and safety exclusions must be visible."
      eyebrow="Trending feed"
      principles={[
        {
          copy: 'A trend discloses whether it is local, community-scoped, regional, or network-wide.',
          eyebrow: 'Context',
          title: 'Popular where, and when',
          tone: 'plum',
        },
        {
          copy: 'Repeated activity and coordinated manipulation cannot be treated as organic consensus.',
          eyebrow: 'Resilience',
          title: 'Abuse does not become momentum',
          tone: 'coral',
        },
        {
          copy: 'People can inspect the score, opt out, or choose a different compatible provider.',
          eyebrow: 'Agency',
          title: 'Explanation beside influence',
          tone: 'sky',
        },
      ]}
      title="Momentum without mystery."
    />
  );
}
