import type { Metadata } from 'next';

import { ExploreDiscovery } from '@/components/explore-discovery';
import { ProductState } from '@/components/product-state';

export const metadata: Metadata = {
  title: 'Explore',
  description:
    'Transparent discovery over the shorts product API. No manufactured trends or engagement counts. Personalization unconfigured.',
};

export default function ExplorePage() {
  return (
    <div className="explore-page">
      <ExploreDiscovery />
      <ProductState
        actionHref="/search"
        actionLabel="Open public search"
        cards={[
          {
            copy: 'Every suggested post should name its source, scoring recipe, and the signals that placed it in view.',
            eyebrow: 'Explainability',
            footer: 'No unexplained ranking',
            title: 'A reason beside the result',
            tone: 'plum',
          },
          {
            copy: 'Opt out of personalization, reset learned preferences, or switch to chronological views without leaving the network.',
            eyebrow: 'Choice',
            footer: 'Portable feed selection',
            title: 'More than one front page',
            tone: 'coral',
          },
          {
            copy: 'Blocks, content warnings, community rules, and lawful service policy remain distinct filters with visible authority.',
            eyebrow: 'Safety',
            footer: 'Layered filtering',
            title: 'Discovery with boundaries',
            tone: 'sky',
          },
        ]}
        detail="Sample cards above come from GET /api/v1/shorts with droolrank-lite (trending) or recency sort. personalization.configured is always false until a real provider ships. Public search remains the indexer-backed path."
        eyebrow="Boundaries"
        intro="Personalization and social-graph explore stay unconfigured. The catalog sample is honest scaffolding, not a live recommendation engine or for-you feed."
        stateEyebrow="No personalized explore"
        stateTitle="No synthetic trends or people lists."
        title="Provider-backed recommendations still await."
      />
    </div>
  );
}
