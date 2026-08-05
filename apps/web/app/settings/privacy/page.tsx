import type { Metadata } from 'next';
import { ButtonLink, InfoCard, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { AgeAccessPolicyPanel } from '@/components/age-access-policy-panel';
import { LocalPreferenceEditor } from '@/components/local-preference-editor';
import { SettingsNav } from '@/components/settings-nav';

export const metadata: Metadata = {
  title: 'Privacy settings',
  description: 'Device-local privacy defaults with honest persistence boundaries.',
};

export default function PrivacySettingsPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="neutral">Local controls available</StatusBadge>}
        eyebrow="Privacy settings"
        title="Share less by default."
      >
        <p>
          These controls save preference intent only in this browser. Relays, messages, and
          discovery providers cannot honor them until their signed contracts are integrated. Age
          access policy below is transparent configuration — not a claim of geo-blocking or ID
          collection.
        </p>
      </AppPageHeader>
      <SettingsNav />
      <p className="field-help">
        Related:{' '}
        <ButtonLink href="/settings/safety" variant="quiet">
          Safety
        </ButtonLink>
        {' · '}
        <ButtonLink href="/settings/devices" variant="quiet">
          Passkeys &amp; devices
        </ButtonLink>
        {' · '}
        <ButtonLink href="/settings/blocks" variant="quiet">
          Local blocks
        </ButtonLink>
      </p>
      <LocalPreferenceEditor kind="privacy" />
      <AgeAccessPolicyPanel />
      <section className="product-card-grid" aria-label="Privacy setting boundaries">
        <InfoCard eyebrow="Local" title="This browser remembers" tone="plum">
          <p>
            Saved switches remain on this device and can be exported or cleared with browser data.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Portable" title="Account policy comes later" tone="coral">
          <p>A signed portable preference requires authenticated identity and conflict handling.</p>
        </InfoCard>
        <InfoCard eyebrow="Service" title="Providers need enforcement" tone="sky">
          <p>
            A preference is not a privacy guarantee until each connected service demonstrably honors
            it.
          </p>
        </InfoCard>
      </section>
    </div>
  );
}
