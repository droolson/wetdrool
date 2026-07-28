import type { Metadata } from 'next';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@socially-woke/ui';

import { AppPageHeader } from '@/components/app-page-header';

export const metadata: Metadata = {
  title: 'Creator profile',
  description: 'A creator surface awaiting verified profile, offering, and entitlement data.',
};

export default async function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const displayId = id.slice(0, 96);

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="degraded">Creator unresolved</StatusBadge>}
        eyebrow="Creator studio"
        title="Support the work, not a locked identity."
      >
        <p>
          Requested identifier: <code className="inline-identifier">{displayId}</code>
          {id.length > displayId.length ? '…' : ''}
        </p>
      </AppPageHeader>

      <section className="creator-ledger" aria-labelledby="creator-ledger-title">
        <div>
          <p className="section-kicker">Portable creator layer</p>
          <h2 id="creator-ledger-title">Audience, archive, and offerings remain separable.</h2>
        </div>
        <p>
          A person can move clients and providers without losing the signed identity behind their
          public work. Payments and entitlements are optional services around that identity.
        </p>
      </section>

      <StatePanel
        action={
          <ButtonLink href={`/creator/${encodeURIComponent(id)}/monetization`} variant="secondary">
            Inspect monetization boundaries
          </ButtonLink>
        }
        eyebrow="No verified creator manifest"
        title="No biography, audience total, or offering was invented."
        tone="empty"
      >
        <p>
          This view needs a signed profile, verified public objects, and current offering records
          before it can attribute work or display support options.
        </p>
      </StatePanel>

      <section className="product-card-grid" aria-label="Creator portability commitments">
        <InfoCard eyebrow="Identity" title="The audience can follow the root" tone="plum">
          <p>
            Moving a storefront or media provider does not require creating a new public person.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Archive" title="Public work stays addressable" tone="coral">
          <p>Signed objects retain provenance even when one presentation service disappears.</p>
        </InfoCard>
        <InfoCard eyebrow="Offerings" title="Terms before checkout" tone="sky">
          <p>
            Price, currency, duration, refunds, delivery, and operator identity remain explicit.
          </p>
        </InfoCard>
      </section>
    </div>
  );
}
