import type { Metadata } from 'next';
import { StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { Composer } from '@/components/composer';
import { getLocalnetPublicationConfig } from '@/lib/localnet-publication-config';

export const metadata: Metadata = {
  title: 'Compose a localnet proof',
  description:
    'Prepare a plain-text WetDrool post and, when the development proof runtime is enabled, verify it end to end on a Solana local validator.',
};

export const dynamic = 'force-dynamic';

export default function ComposePage() {
  const publicationConfig = getLocalnetPublicationConfig();
  const publicationAvailable = publicationConfig.kind === 'available';

  return (
    <div className="compose-page page-shell">
      <AppPageHeader
        actions={
          <StatusBadge tone={publicationAvailable ? 'verified' : 'pending'}>
            {publicationAvailable ? 'Localnet proof enabled' : 'Publication locked'}
          </StatusBadge>
        }
        eyebrow="Passkey-first publication studio"
        title={publicationAvailable ? 'Prove a post, end to end.' : 'Make the meaning clear.'}
      >
        {publicationAvailable ? (
          <p>
            Create a public plain-text proof with a fresh passkey approval, verified local content
            storage, a finalized DroolNet program transaction, and an indexed checkpoint. This
            development path uses a Solana local validator and faucet-issued test SOL only.
          </p>
        ) : (
          <p>
            Shape a portable post and its boundaries without implying that it was published. Saved
            drafts stay in this browser while the development-only proof runtime is locked.
          </p>
        )}
      </AppPageHeader>
      <Composer publicationConfig={publicationConfig} />
    </div>
  );
}
