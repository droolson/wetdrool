import type { Metadata } from 'next';

import { BoundarySurface } from '@/components/boundary-surface';
import { SettingsNav } from '@/components/settings-nav';

export const metadata: Metadata = {
  title: 'Account migration',
  description: 'Provider and client migration boundaries without simulated transfer.',
};

export default function MigrationSettingsPage() {
  return (
    <BoundarySurface
      cards={[
        {
          copy: 'Protocol identity and public relationship state are reconstructed at a declared checkpoint.',
          eyebrow: 'Source',
          footer: 'Checkpoint disclosed',
          title: 'Start from portable truth',
          tone: 'plum',
        },
        {
          copy: 'Every signed profile, post, and media object is retrieved and hash-checked before import.',
          eyebrow: 'Objects',
          footer: 'Integrity before display',
          title: 'Move bytes without changing them',
          tone: 'coral',
        },
        {
          copy: 'Private settings, drafts, messages, and encryption keys require separate consent and compatible formats.',
          eyebrow: 'Private data',
          footer: 'Never assumed portable',
          title: 'Ask before carrying secrets',
          tone: 'sky',
        },
      ]}
      detail="No source archive, destination provider, authenticated identity, compatibility audit, or rollback plan is configured. A transfer cannot be previewed or started."
      eyebrow="Migration"
      intro="Moving clients or providers should preserve portable identity while clearly naming private data that cannot move automatically."
      navigation={<SettingsNav />}
      requirements={[
        { label: 'Verified export', state: 'Not prepared' },
        { label: 'Destination compatibility', state: 'Not evaluated' },
        { label: 'Rollback checkpoint', state: 'Not established' },
      ]}
      stateTitle="No migration was started."
      title="Move without becoming someone new."
    />
  );
}
