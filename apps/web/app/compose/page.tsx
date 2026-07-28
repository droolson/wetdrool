import type { Metadata } from 'next';
import { StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { Composer } from '@/components/composer';

export const metadata: Metadata = {
  title: 'Compose',
  description:
    'Prepare and preview a WokeSocial post in local browser storage without simulating publication.',
};

export default function ComposePage() {
  return (
    <div className="compose-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Publication locked</StatusBadge>}
        eyebrow="Local-first studio"
        title="Make the meaning clear."
      >
        <p>
          Shape a portable post and its boundaries before any signer, storage service, or chain
          transaction is involved. Saved drafts stay in this browser.
        </p>
      </AppPageHeader>
      <Composer />
    </div>
  );
}
