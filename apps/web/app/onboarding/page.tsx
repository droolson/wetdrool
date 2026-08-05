import type { Metadata } from 'next';
import { ButtonLink, InfoCard, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { AuthServiceStatus } from '@/components/auth-service-status';
import { PasskeyAuthPanel } from '@/components/passkey-auth-panel';
import { resolveAuthServiceConfig } from '@/lib/auth/auth-service-config';

export const metadata: Metadata = {
  title: 'Onboarding',
  description: 'Create a replaceable authentication-service account with a passkey.',
};

export const dynamic = 'force-dynamic';

const STEPS = [
  {
    copy: 'Create a user-verifying service account and a credential-bound encrypted Ed25519 seed without publishing an email, legal name, or secret.',
    eyebrow: 'Step 01',
    footer: 'Passkey service path available',
    title: 'Create private key access',
    tone: 'plum' as const,
  },
  {
    copy: 'Receive a collision-resistant anonymous .drool candidate from the public passkey root, then add optional profile details with field-level visibility.',
    eyebrow: 'Step 02',
    footer: 'Onchain claim still required',
    title: 'Start pseudonymously',
    tone: 'coral' as const,
  },
  {
    copy: 'Select feeds, safety defaults, storage providers, and a recovery plan before joining the public conversation.',
    eyebrow: 'Step 03',
    footer: 'Preferences remain portable',
    title: 'Set your boundaries',
    tone: 'sky' as const,
  },
] as const;

export default function OnboardingPage() {
  const authServiceUrl = resolveAuthServiceConfig().origin;

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Service account path</StatusBadge>}
        eyebrow="Begin with context"
        title="Your identity should start with consent."
      >
        <p>
          Passkey approval can now atomically create an authentication-service account and its
          credential-bound encrypted key wrapper. A random anonymous .drool candidate is derived
          locally from the public root without email or legal identity. Profile publication,
          recovery, protocol identity creation, and the onchain name claim are still unavailable.
        </p>
      </AppPageHeader>

      <AuthServiceStatus />

      <section className="onboarding-ledger" aria-labelledby="onboarding-ledger-title">
        <div>
          <p className="section-kicker">Before you begin</p>
          <h2 id="onboarding-ledger-title">Only the passkey action changes account state.</h2>
        </div>
        <dl>
          <div>
            <dt>Service account</dt>
            <dd>Created only after passkey approval</dd>
          </div>
          <div>
            <dt>Private key</dt>
            <dd>Generated only with PRF support</dd>
          </div>
          <div>
            <dt>Protocol write</dt>
            <dd>Not attempted</dd>
          </div>
          <div>
            <dt>Anonymous name</dt>
            <dd>Derived locally; not an onchain claim</dd>
          </div>
        </dl>
      </section>

      <section className="product-card-grid" aria-label="Onboarding steps">
        {STEPS.map((step) => (
          <InfoCard
            eyebrow={step.eyebrow}
            footer={step.footer}
            key={step.title}
            title={step.title}
            tone={step.tone}
          >
            <p>{step.copy}</p>
          </InfoCard>
        ))}
      </section>

      <section className="product-cta product-cta--auth" aria-labelledby="create-account-title">
        <div>
          <p className="section-kicker">Replaceable authentication</p>
          <h2 id="create-account-title">Create a service account with your passkey.</h2>
          <p>
            The browser requires a discoverable, user-verifying credential with the PRF extension. A
            new Ed25519 seed is encrypted locally, then the credential and ciphertext-only wrapper
            are committed together. If either part fails, no service account is activated. The
            resulting public root deterministically yields an anonymous .drool candidate, but no
            protocol identity or name claim is created.
          </p>
          <div className="product-cta__actions">
            <ButtonLink href="/signin" variant="secondary">
              Use an existing passkey
            </ButtonLink>
            <ButtonLink href="/settings/providers" variant="quiet">
              Review providers
            </ButtonLink>
          </div>
        </div>
        <PasskeyAuthPanel authServiceUrl={authServiceUrl} mode="register" />
      </section>
    </div>
  );
}
