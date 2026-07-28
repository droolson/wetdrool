import type { Metadata } from 'next';

import { FeedSurface } from '@/components/feed-surface';

export const metadata: Metadata = {
  title: 'Following feed',
  description: 'A relationship-scoped feed awaiting authenticated identity and indexer support.',
};

export default function FollowingFeedPage() {
  return (
    <FeedSurface
      contract={[
        { label: 'Viewer', value: 'Authenticated current identity or delegation' },
        { label: 'Graph', value: 'Verified active follows at a declared checkpoint' },
        { label: 'Order', value: 'Published deterministic recipe and stable cursor' },
      ]}
      detail="Following is personal without needing to be opaque. It should derive from relationships the viewer can verify and exclude inactive or revoked authority."
      eyebrow="Following feed"
      principles={[
        {
          copy: 'Every included author must be reachable through a current, verified follow edge.',
          eyebrow: 'Scope',
          title: 'Chosen relationships only',
          tone: 'plum',
        },
        {
          copy: 'Local blocks and safety filters apply before any provider ranking or boost.',
          eyebrow: 'Safety',
          title: 'Personal boundaries first',
          tone: 'coral',
        },
        {
          copy: 'A chronological option and recipe explanation remain available beside any ranking.',
          eyebrow: 'Choice',
          title: 'Ranking can be questioned',
          tone: 'sky',
        },
      ]}
      title="The people you chose, with receipts."
    />
  );
}
