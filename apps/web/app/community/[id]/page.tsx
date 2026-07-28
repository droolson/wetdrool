import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@socially-woke/ui';

import { AppPageHeader } from '@/components/app-page-header';

export const metadata: Metadata = {
  title: 'Community',
  description: 'Inspect a community identifier without fabricating community state.',
};

export default async function CommunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const displayId = id.slice(0, 96);

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="degraded">Unresolved identifier</StatusBadge>}
        eyebrow="Community"
        title="A space must prove its rules."
      >
        <p>
          Requested identifier: <code className="inline-identifier">{displayId}</code>
          {id.length > displayId.length ? '…' : ''}
        </p>
      </AppPageHeader>

      <nav className="route-action-strip" aria-label="Community sections">
        <Link href={`/community/${encodeURIComponent(id)}`}>Overview</Link>
        <Link href={`/community/${encodeURIComponent(id)}/governance`}>Governance</Link>
        <Link href={`/community/${encodeURIComponent(id)}/admin`}>Administration</Link>
      </nav>

      <StatePanel
        action={
          <ButtonLink href="/communities" variant="secondary">
            Back to communities
          </ButtonLink>
        }
        eyebrow="No verified manifest"
        title="This identifier was not resolved to community state."
        tone="empty"
      >
        <p>
          A compatible projection must return the signed manifest, membership rules, current
          governance, and moderation authority before this page can present or join the community.
        </p>
      </StatePanel>

      <section className="product-card-grid" aria-label="Required community records">
        <InfoCard eyebrow="Manifest" title="Name, purpose, and visibility" tone="plum">
          <p>Human-readable details must match a signed, content-addressed community object.</p>
        </InfoCard>
        <InfoCard eyebrow="Authority" title="Roles and governance" tone="coral">
          <p>Moderator and member powers must be current, scoped, and attributable.</p>
        </InfoCard>
        <InfoCard eyebrow="Federation" title="Connections and boundaries" tone="sky">
          <p>Allowlists, blocklists, and external service policy need visible provenance.</p>
        </InfoCard>
      </section>
    </div>
  );
}
