import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from '@/components/app-page-header';

export const metadata: Metadata = {
  title: 'Profile',
  description: 'Inspect a portable identity reference without fabricating profile state.',
};

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const displayId = id.slice(0, 96);

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="degraded">Identity unresolved</StatusBadge>}
        eyebrow="Portable profile"
        title="A person is more than an address."
      >
        <p>
          Requested identifier: <code className="inline-identifier">{displayId}</code>
          {id.length > displayId.length ? '…' : ''}
        </p>
      </AppPageHeader>

      <nav className="route-action-strip" aria-label="Profile sections">
        <Link href={`/profile/${encodeURIComponent(id)}`}>Profile</Link>
        <Link href={`/profile/${encodeURIComponent(id)}/edit`}>Edit readiness</Link>
      </nav>

      <StatePanel
        action={
          <ButtonLink href="/search" variant="secondary">
            Open search
          </ButtonLink>
        }
        eyebrow="No signed profile"
        title="This identifier was not resolved by a profile provider."
        tone="empty"
      >
        <p>
          The page needs current identity authority, a verified profile manifest, and visible field
          permissions before it can show a name, handle, avatar, relationships, or posts.
        </p>
      </StatePanel>

      <section className="product-card-grid" aria-label="Profile privacy commitments">
        <InfoCard eyebrow="Names" title="Chosen and current" tone="plum">
          <p>
            Clients should protect current chosen names while representing historical state
            honestly.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Disclosure" title="Each field has a boundary" tone="coral">
          <p>
            Languages, location, and optional profile details can be public, limited, or absent.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Authority" title="Keys stay backstage" tone="sky">
          <p>Wallet and device identifiers prove control; they do not replace a human profile.</p>
        </InfoCard>
      </section>
    </div>
  );
}
