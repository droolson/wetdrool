import type { Metadata } from 'next';
import { ButtonLink, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { AuthServiceStatus } from '@/components/auth-service-status';
import { PasskeyAccessManager } from '@/components/passkey-access-manager';
import { SettingsNav } from '@/components/settings-nav';
import { resolveAuthServiceConfig } from '@/lib/auth/auth-service-config';

export const metadata: Metadata = {
  title: 'Passkeys and devices',
  description:
    'List, add, and revoke authentication-service passkeys without conflating them with DroolNet authority.',
};

export const dynamic = 'force-dynamic';

export default function DeviceSettingsPage() {
  const authServiceUrl = resolveAuthServiceConfig().origin;

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Service credentials</StatusBadge>}
        eyebrow="Passkeys and devices"
        title="Know which passkeys can open your account."
      >
        <p>
          This page manages credential records reported by the configured authentication service (
          <code className="inline-identifier">{authServiceUrl}</code>). Every addition and
          revocation requires a fresh user-verifying passkey action. A listed passkey is not a
          DroolNet device registration or onchain delegation.
        </p>
      </AppPageHeader>

      <SettingsNav />

      <AuthServiceStatus />

      <p className="field-help">
        Need a session first?{' '}
        <ButtonLink href="/signin" variant="quiet">
          Sign in
        </ButtonLink>{' '}
        or{' '}
        <ButtonLink href="/onboarding" variant="quiet">
          create a passkey account
        </ButtonLink>
        . Privacy and age-access controls live under{' '}
        <ButtonLink href="/settings/privacy" variant="quiet">
          Privacy
        </ButtonLink>
        .
      </p>

      <section className="passkey-access-shell" aria-label="Passkey access manager">
        <PasskeyAccessManager authServiceUrl={authServiceUrl} />
      </section>

      <section className="onboarding-ledger" aria-labelledby="passkey-boundary-title">
        <div>
          <p className="section-kicker">Authority boundary</p>
          <h2 id="passkey-boundary-title">A service passkey is not a DroolNet delegation.</h2>
        </div>
        <dl>
          <div>
            <dt>Managed here</dt>
            <dd>Authentication-service credentials and encrypted wrappers</dd>
          </div>
          <div>
            <dt>Not changed here</dt>
            <dd>Protocol identity, WetDrool authority, and onchain delegations</dd>
          </div>
          <div>
            <dt>Revocation policy</dt>
            <dd>All service sessions end; onchain authority requires a separate action</dd>
          </div>
          <div>
            <dt>Honest readiness</dt>
            <dd>
              Use the probe above — never treat this page as proof the public network is online
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
