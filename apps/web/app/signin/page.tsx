import type { Metadata } from 'next';
import { ButtonLink, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { PasskeyAuthPanel } from '@/components/passkey-auth-panel';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to the replaceable authentication service with a user-verifying passkey.',
};

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  const authServiceUrl =
    process.env['WETDROOL_AUTH_URL'] ??
    process.env['NEXT_PUBLIC_AUTH_SERVICE_URL'] ??
    'http://localhost:4300';

  return (
    <div className="auth-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Replaceable passkey path</StatusBadge>}
        eyebrow="Portable identity"
        title="Come back as yourself."
      >
        <p>
          A passkey can now prove control of an authentication-service account and reopen its
          credential-bound encrypted key locally. This path does not publish a profile, submit a
          transaction, or create an onchain identity.
        </p>
      </AppPageHeader>

      <div className="auth-layout">
        <section className="auth-panel" aria-labelledby="signin-options-title">
          <div>
            <p className="section-kicker">Sign-in methods</p>
            <h2 id="signin-options-title">Choose a proof, not a platform account.</h2>
          </div>

          <PasskeyAuthPanel authServiceUrl={authServiceUrl} mode="signin" />

          <div className="auth-method-unavailable" role="note">
            <span aria-hidden="true">02</span>
            <span>
              <strong>External wallet</strong>
              <small>Unavailable until wallet review, simulation, and verification are wired</small>
            </span>
          </div>

          <p className="auth-panel__note">
            Wallet and recovery-kit fallback routes are not active in this build. Do not enter a
            seed phrase or private key into this site.
          </p>
          <ButtonLink href="/settings/providers" variant="secondary">
            Review connection readiness
          </ButtonLink>
          <ButtonLink href="/recovery" variant="quiet">
            Inspect recovery safeguards →
          </ButtonLink>
        </section>

        <aside className="auth-assurance" aria-labelledby="signin-assurance-title">
          <p className="section-kicker">What sign-in must prove</p>
          <h2 id="signin-assurance-title">The root is yours. The session is limited.</h2>
          <ol>
            <li>
              <strong>Challenge</strong>
              <span>A fresh, origin-bound challenge is consumed once by the auth service.</span>
            </li>
            <li>
              <strong>Authority</strong>
              <span>The discoverable credential maps to an active service account.</span>
            </li>
            <li>
              <strong>Local key</strong>
              <span>PRF output unwraps matching ciphertext in the browser and is never sent.</span>
            </li>
          </ol>
          <p>
            This is authentication and local key access—not protocol authority. Recovery remains
            unavailable, so do not send secrets to anyone claiming they can activate it.
          </p>
        </aside>
      </div>
    </div>
  );
}
