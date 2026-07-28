import type { Metadata } from 'next';

import { BoundarySurface } from '@/components/boundary-surface';
import { SettingsNav } from '@/components/settings-nav';

export const metadata: Metadata = {
  title: 'Devices',
  description: 'Device-session readiness without fabricated sessions or revocation.',
};

export default function DeviceSettingsPage() {
  return (
    <BoundarySurface
      cards={[
        {
          copy: 'A device label is private convenience metadata, separate from the public authority key.',
          eyebrow: 'Privacy',
          footer: 'Labels stay offchain',
          title: 'Recognizable without exposure',
          tone: 'plum',
        },
        {
          copy: 'Last-seen state identifies its observing service and never pretends to be global truth.',
          eyebrow: 'Freshness',
          footer: 'Observer is disclosed',
          title: 'Activity with provenance',
          tone: 'coral',
        },
        {
          copy: 'Revocation targets a precise session or delegation and is verified after finality.',
          eyebrow: 'Control',
          footer: 'No decorative sign-out',
          title: 'End the right authority',
          tone: 'sky',
        },
      ]}
      detail="No signed-in identity, session registry, device-key projection, or revocation adapter is connected. This page therefore shows no invented device names or activity times."
      eyebrow="Devices"
      intro="Devices should be understandable to their owner while cryptographic authority remains precise and revocable."
      navigation={<SettingsNav />}
      requirements={[
        { label: 'Viewer identity', state: 'Not authenticated' },
        { label: 'Session registry', state: 'Not configured' },
        { label: 'Revocation path', state: 'Not configured' },
      ]}
      stateTitle="There are no verified device sessions to list."
      title="Know where your identity can speak."
    />
  );
}
