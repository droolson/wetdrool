import type { Metadata } from 'next';

import { BoundarySurface } from '@/components/boundary-surface';
import { SettingsNav } from '@/components/settings-nav';

export const metadata: Metadata = {
  title: 'Delegations',
  description: 'Delegated authority boundaries without inferred scopes.',
};

export default function DelegationSettingsPage() {
  return (
    <BoundarySurface
      cards={[
        {
          copy: 'Posting, profiles, social graph, communities, and moderation use distinct explicit scopes.',
          eyebrow: 'Scope',
          footer: 'Least authority',
          title: 'One job per delegation',
          tone: 'plum',
        },
        {
          copy: 'Expiry and root-rotation epoch are checked at the exact position of every attempted action.',
          eyebrow: 'Time',
          footer: 'Fail closed',
          title: 'Authority has an end',
          tone: 'coral',
        },
        {
          copy: 'A current root can revoke a delegation without relying on the delegated device.',
          eyebrow: 'Revocation',
          footer: 'Root-controlled',
          title: 'A clean way back',
          tone: 'sky',
        },
      ]}
      detail="No identity authority or exhaustive delegation projection is available to this browser. It cannot safely list, create, extend, or revoke delegated keys."
      eyebrow="Delegations"
      intro="A device should receive only the narrow authority it needs, for a visible duration, under the current root epoch."
      navigation={<SettingsNav />}
      requirements={[
        { label: 'Current root', state: 'Not authenticated' },
        { label: 'Scope registry', state: 'Read-only protocol design' },
        { label: 'Finality verification', state: 'Not connected' },
      ]}
      stateTitle="No delegated authority was resolved."
      title="Small keys, smaller permissions."
    />
  );
}
