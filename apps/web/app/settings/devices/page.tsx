import type { Metadata } from 'next';
import { StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { PasskeyAccessManager } from '@/components/passkey-access-manager';
import { SettingsNav } from '@/components/settings-nav';

export const metadata: Metadata = {
  title: 'Passkeys and devices',
  description:
    'List, add, and revoke authentication-service passkeys without conflating them with WokeNet authority.',
};

export const dynamic = 'force-dynamic';

export default function DeviceSettingsPage() {
  const authServiceUrl =
    process.env['WOKESOCIAL_AUTH_URL'] ??
    process.env['NEXT_PUBLIC_AUTH_SERVICE_URL'] ??
    'http://localhost:4300';

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Service credentials</StatusBadge>}
        eyebrow="Passkeys and devices"
        title="Know which passkeys can open your account."
      >
        <p>
          This page manages credential records reported by the configured authentication service.
          Every addition and revocation requires a fresh user-verifying passkey action.
        </p>
      </AppPageHeader>

      <SettingsNav />

      <section className="passkey-access-shell" aria-label="Passkey access manager">
        <PasskeyAccessManager authServiceUrl={authServiceUrl} />
      </section>

      <section className="onboarding-ledger" aria-labelledby="passkey-boundary-title">
        <div>
          <p className="section-kicker">Authority boundary</p>
          <h2 id="passkey-boundary-title">A service passkey is not a WokeNet delegation.</h2>
        </div>
        <dl>
          <div>
            <dt>Managed here</dt>
            <dd>Authentication-service credentials and encrypted wrappers</dd>
          </div>
          <div>
            <dt>Not changed here</dt>
            <dd>Protocol identity, WokeNet authority, and onchain delegations</dd>
          </div>
          <div>
            <dt>Revocation policy</dt>
            <dd>All service sessions end; onchain authority requires a separate action</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
