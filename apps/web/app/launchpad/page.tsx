import type { Metadata } from 'next';
import { StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { Launchpad } from '@/components/launchpad';

export const metadata: Metadata = {
  title: 'Launchpad',
  description:
    'Preview of the Solana token launchpad built into the feed: fair bonding curves, verified social sentiment, and noncustodial agent rails.',
};

export default function LaunchpadPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Gated preview</StatusBadge>}
        eyebrow="Launchpad"
        title="Launch a Solana token where the conversation already is."
      >
        <p>
          Fair bonding-curve launches, trading beside the thread, verified social sentiment, and AI
          analysis with sources — with your keys, your <code>.woke</code> identity, and the exact
          destination disclosed before every signature.
        </p>
      </AppPageHeader>

      <Launchpad />
    </div>
  );
}
