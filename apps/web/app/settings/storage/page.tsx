import type { Metadata } from 'next';

import { BoundarySurface } from '@/components/boundary-surface';
import { SettingsNav } from '@/components/settings-nav';

export const metadata: Metadata = {
  title: 'Storage settings',
  description: 'Content storage policy boundaries and verified-receipt requirements.',
};

export default function StorageSettingsPage() {
  return (
    <BoundarySurface
      cards={[
        {
          copy: 'Content-addressed storage can be replicated and removed by providers without changing its hash.',
          eyebrow: 'IPFS',
          footer: 'Availability is provider-dependent',
          title: 'Portable, not automatically permanent',
          tone: 'plum',
        },
        {
          copy: 'Permanent storage needs an explicit consent step because later deletion cannot be honestly promised.',
          eyebrow: 'Arweave',
          footer: 'Irreversibility disclosed',
          title: 'Permanent means a different choice',
          tone: 'coral',
        },
        {
          copy: 'Every adapter returns bytes, digest, media type, provider, and read-back verification.',
          eyebrow: 'Receipt',
          footer: 'Exact bytes checked',
          title: 'Uploads need evidence',
          tone: 'sky',
        },
      ]}
      detail="No browser upload adapter, storage credential, provider health check, or receipt verifier is configured. Selecting a provider here would create a preference the app cannot yet honor."
      eyebrow="Storage"
      intro="Public objects can use replaceable content-addressed or permanent storage, but availability and deletion promises differ."
      navigation={<SettingsNav />}
      requirements={[
        { label: 'Storage adapters', state: 'Not connected' },
        { label: 'Receipt verification', state: 'Not connected' },
        { label: 'Deletion policy', state: 'Provider-specific, unresolved' },
      ]}
      stateTitle="No storage policy was changed."
      title="Choose where the bytes live—and what that means."
    />
  );
}
