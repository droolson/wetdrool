import type { Metadata } from 'next';
import { InfoCard, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { LocalPreferenceEditor } from '@/components/local-preference-editor';
import { SettingsNav } from '@/components/settings-nav';
import { ageAccessPolicySnapshot } from '@/lib/age-access-policy';

export const metadata: Metadata = {
  title: 'Privacy settings',
  description: 'Device-local privacy defaults with honest persistence boundaries.',
};

function AgeAccessPolicyPanel() {
  const policy = ageAccessPolicySnapshot(null);

  return (
    <section className="product-card" aria-labelledby="age-access-policy-title">
      <div className="section-heading">
        <p className="section-kicker">Age access policy</p>
        <h2 id="age-access-policy-title">18+ · self-attest by default</h2>
      </div>
      <p>
        Adult surfaces use a <strong>local self-attestation</strong> gate (minimum age{' '}
        {policy.minimumAge}). WetDrool does not collect government ID images or numbers by
        default. A wallet signature is never age proof.
      </p>
      <dl className="e2ee-status__grid">
        <div>
          <dt>Outcome</dt>
          <dd>
            <StatusBadge tone="neutral">{policy.outcome}</StatusBadge>
          </dd>
        </div>
        <div>
          <dt>Default proof</dt>
          <dd>
            <code className="inline-identifier">{policy.defaultProof}</code>
          </dd>
        </div>
        <div>
          <dt>Collect government ID</dt>
          <dd>
            <strong>{String(policy.collectGovernmentId)}</strong>
          </dd>
        </div>
        <div>
          <dt>Wallet is age proof</dt>
          <dd>
            <strong>{String(policy.walletIsAgeProof)}</strong>
          </dd>
        </div>
        <div>
          <dt>Operator vehicle</dt>
          <dd>{policy.operator.label}</dd>
        </div>
        <div>
          <dt>Policy version</dt>
          <dd>{policy.version}</dd>
        </div>
      </dl>
      <ul className="e2ee-status__details">
        {policy.reasons.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="muted-copy">{policy.operator.detail}</p>
    </section>
  );
}

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
          discovery providers cannot honor them until their signed contracts are integrated.
        </p>
      </AppPageHeader>
      <SettingsNav />
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
