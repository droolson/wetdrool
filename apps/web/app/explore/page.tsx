import type { Metadata } from 'next';

import { ProductState } from '@/components/product-state';

export const metadata: Metadata = {
  title: 'Explore',
  description: 'A transparent discovery surface awaiting a compatible recommendation provider.',
};

export default function ExplorePage() {
  return (
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
      detail="Public search is connected through the configured indexer, but no compatible recommendation endpoint is configured. This page will not manufacture trends, people, or engagement counts."
      eyebrow="Network discovery"
      intro="Explore should widen a world without hiding why something appeared. Public search is available separately; this surface still awaits provider-backed recommendations and their explanations."
      stateEyebrow="No discovery response"
      stateTitle="There are no synthetic trends here."
      title="Find a wider conversation."
    />
  );
}
