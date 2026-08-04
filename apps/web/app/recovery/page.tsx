import type { Metadata } from 'next';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';

export const metadata: Metadata = {
  title: 'Account recovery',
  description: 'Inspect recovery safeguards without entering or transmitting secret material.',
};

export default function RecoveryPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="unavailable">Recovery service unavailable</StatusBadge>}
        eyebrow="Account recovery"
        title="Regain control without surrendering secrets."
      >
        <p>
          Recovery must replace identity authority through a verified policy. This page never asks
          for a seed phrase, private key, email code, or sensitive evidence.
        </p>
      </AppPageHeader>

      <section className="recovery-map" aria-labelledby="recovery-map-title">
        <div>
          <p className="section-kicker">Recovery sequence</p>
          <h2 id="recovery-map-title">A new root needs more than a familiar screen.</h2>
        </div>
        <ol>
          <li>
            <span aria-hidden="true">01</span>
            <div>
              <strong>Resolve the current policy</strong>
              <p>Read the signed threshold, delay, delegates, and revocation epoch.</p>
            </div>
          </li>
          <li>
            <span aria-hidden="true">02</span>
            <div>
              <strong>Collect authorized proofs</strong>
              <p>Use only the methods named by that policy; never improvise secret collection.</p>
            </div>
          </li>
          <li>
            <span aria-hidden="true">03</span>
            <div>
              <strong>Finalize and verify rotation</strong>
              <p>Confirm the replacement root and invalidate authority from the prior epoch.</p>
            </div>
          </li>
        </ol>
      </section>

      <StatePanel
        action={
          <ButtonLink href="/signin" variant="secondary">
            Return to sign-in readiness
          </ButtonLink>
        }
        eyebrow="No recovery started"
        title="Secret entry is intentionally absent."
        tone="degraded"
      >
        <p>
          Until recovery-policy reads, authorized proof verification, transaction simulation,
          explicit confirmation, and finality checks are wired, no recovery request can be created.
        </p>
      </StatePanel>

      <section className="product-card-grid" aria-label="Recovery safeguards">
        <InfoCard eyebrow="Never share" title="Seed phrases stay offline" tone="plum">
          <p>No legitimate recovery screen should ask a person to paste a wallet seed phrase.</p>
        </InfoCard>
        <InfoCard eyebrow="Delay" title="Time to stop an attacker" tone="coral">
          <p>High-risk rotations need visible delays and a current-root cancellation path.</p>
        </InfoCard>
        <InfoCard eyebrow="Epoch" title="Old delegates expire together" tone="sky">
          <p>A completed root rotation invalidates authority minted under the previous epoch.</p>
        </InfoCard>
      </section>
    </div>
  );
}
