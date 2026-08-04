import type { Metadata } from 'next';
import { InfoCard, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { LocalPreferenceEditor } from '@/components/local-preference-editor';
import { SettingsNav } from '@/components/settings-nav';

export const metadata: Metadata = {
  title: 'Safety settings',
  description: 'Device-local safety presentation defaults without false protocol persistence.',
};

export default function SafetySettingsPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="neutral">Local controls available</StatusBadge>}
        eyebrow="Safety settings"
        title="Put a softer edge on the room."
      >
        <p>
          Presentation defaults can reduce surprise on this device. They do not replace portable
          blocks, community moderation, lawful service policy, or emergency support.
        </p>
      </AppPageHeader>
      <SettingsNav />
      <LocalPreferenceEditor kind="safety" />
      <section className="product-card-grid" aria-label="Safety layer boundaries">
        <InfoCard eyebrow="Personal" title="Your client, your boundary" tone="plum">
          <p>Local media and reply controls can be changed without asking a community moderator.</p>
        </InfoCard>
        <InfoCard eyebrow="Community" title="Rules stay scoped" tone="coral">
          <p>
            Community labels and actions identify their issuing role and apply only in that space.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Protocol" title="Narrow, exceptional authority" tone="sky">
          <p>
            Protocol-wide restrictions require explicit governance and cannot be inferred by a
            client.
          </p>
        </InfoCard>
      </section>
    </div>
  );
}
