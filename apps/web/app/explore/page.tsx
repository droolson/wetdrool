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
      actionLabel="Open honest search"
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
      detail="No compatible discovery or recommendation endpoint is configured, so this page will not manufacture trends, people, or engagement counts."
      eyebrow="Network discovery"
      intro="Explore should widen a world without hiding why something appeared. This surface is ready for provider-backed results and their explanations."
      stateEyebrow="No discovery response"
      stateTitle="There are no synthetic trends here."
      title="Find a wider conversation."
    />
  );
}
