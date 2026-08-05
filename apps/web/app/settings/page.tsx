import type { Metadata } from 'next';
import { ButtonLink, InfoCard, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { AuthServiceStatus } from '@/components/auth-service-status';
import { SettingsNav } from '@/components/settings-nav';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Review local and provider-backed WetDrool settings surfaces.',
};

export default function SettingsPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Partial settings surface</StatusBadge>}
        eyebrow="Your controls"
        title="Make the network fit you."
      >
        <p>
          Settings should distinguish device-local preferences, portable signed choices, and
          provider configuration. Only implemented controls are active.
        </p>
      </AppPageHeader>

      <SettingsNav />

      <section className="settings-account-readiness" aria-labelledby="account-readiness-title">
        <div>
          <p className="section-kicker">Account readiness</p>
          <h2 id="account-readiness-title">Authentication service before passkeys.</h2>
          <p className="field-help">
            Passkey create/sign-in and device management depend on a reachable, ready
            authentication service. This probe never invents “online,” never establishes protocol
            identity, and never uses a legacy redirect host as WebAuthn RP. If the service is
            unconfigured, invalid, or unreachable, treat account controls as empty until you fix
            readiness and retry.
          </p>
        </div>
        <AuthServiceStatus settingsContext />
        <p className="field-help">
          When ready:{' '}
          <ButtonLink href="/settings/devices" variant="quiet">
            Passkeys &amp; devices
          </ButtonLink>
          {' · '}
          <ButtonLink href="/signin" variant="quiet">
            Sign in
          </ButtonLink>
          {' · '}
          <ButtonLink href="/onboarding" variant="quiet">
            Create passkey account
          </ButtonLink>
          . When not ready:{' '}
          <ButtonLink href="/settings/providers" variant="quiet">
            Provider settings
          </ButtonLink>
          {' '}
          (retry probe from the status card above).
        </p>
      </section>

      <section className="settings-grid" aria-label="Settings categories">
        <InfoCard
          eyebrow="Privacy"
          footer={
            <ButtonLink href="/settings/privacy" variant="quiet">
              Open privacy settings →
            </ButtonLink>
          }
          title="Device-local privacy"
          tone="plum"
        >
          <p>Save presence, read-receipt, and discovery defaults in this browser.</p>
        </InfoCard>
        <InfoCard
          eyebrow="Safety"
          footer={
            <ButtonLink href="/settings/safety" variant="quiet">
              Open safety settings →
            </ButtonLink>
          }
          title="Presentation boundaries"
          tone="coral"
        >
          <p>Choose safer media and reply defaults without claiming portable enforcement.</p>
        </InfoCard>
        <InfoCard
          eyebrow="Blocks"
          footer={
            <ButtonLink href="/settings/blocks" variant="quiet">
              Open local list →
            </ButtonLink>
          }
          title="Reversible local filtering"
          tone="sky"
        >
          <p>Hide exact identity IDs from the connected home feed on this device.</p>
        </InfoCard>
        <InfoCard
          eyebrow="Account"
          footer={
            <ButtonLink href="/settings/devices" variant="quiet">
              Passkeys &amp; devices →
            </ButtonLink>
          }
          title="Devices and delegations"
        >
          <p>
            Manage auth-service passkeys when the probe above is ready. Session and scoped-authority
            protocol controls remain locked until identity is authenticated onchain.
          </p>
        </InfoCard>
        <InfoCard
          eyebrow="Infrastructure"
          footer={
            <ButtonLink href="/settings/providers" variant="quiet">
              Open provider settings →
            </ButtonLink>
          }
          title="Providers and storage"
        >
          <p>
            Inspect configured service origins and the different promises storage policies make.
          </p>
        </InfoCard>
        <InfoCard
          eyebrow="Data"
          footer={
            <ButtonLink href="/settings/export" variant="quiet">
              Open export settings →
            </ButtonLink>
          }
          title="Export, migration, deletion"
        >
          <p>
            Download local settings now; inspect the receipts a full account operation requires.
          </p>
        </InfoCard>
      </section>
    </div>
  );
}
