import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { getIdentityProfile, type IdentityProfileView } from '@/lib/identity-profile';
import { formatUtcDate } from '@/lib/presentation';

export const metadata: Metadata = {
  title: 'Profile',
  description: 'Inspect a portable identity reference without fabricating profile state.',
};

export const dynamic = 'force-dynamic';

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identityId = decodeRouteSegment(id);
  const result = await getIdentityProfile(identityId);

  if (result.kind === 'ready') {
    return <ConnectedProfile endpoint={result.endpoint} view={result.value} />;
  }

  const displayId = identityId.slice(0, 96);
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="degraded">Identity unresolved</StatusBadge>}
        eyebrow="Portable profile"
        title="A person is more than an address."
      >
        <p>
          Requested identifier: <code className="inline-identifier">{displayId}</code>
          {identityId.length > displayId.length ? '…' : ''}
        </p>
      </AppPageHeader>

      {result.kind === 'invalid-identifier' ? (
        <StatePanel
          action={
            <ButtonLink href="/search" variant="secondary">
              Open search
            </ButtonLink>
          }
          eyebrow="Not an identity ID"
          title="This identifier is not a portable WokeSocial identity."
          tone="empty"
        >
          <p>
            Profile routes resolve exact <code>wokesocialid:v1</code> identifiers. Use search to
            find people by name or handle instead of guessing an identifier.
          </p>
        </StatePanel>
      ) : result.kind === 'not-found' ? (
        <StatePanel
          action={
            <ButtonLink href="/search" variant="secondary">
              Open search
            </ButtonLink>
          }
          eyebrow="No indexed identity"
          title="This identifier was not resolved by the configured projection."
          tone="empty"
        >
          <p>
            The configured indexer has no finalized record of this identity. No placeholder profile
            is substituted.
          </p>
        </StatePanel>
      ) : (
        <StatePanel
          action={
            <ButtonLink href="/settings/providers" variant="secondary">
              Review providers
            </ButtonLink>
          }
          eyebrow="Profile unavailable"
          title="No unverified placeholder was substituted."
          tone="degraded"
        >
          <p>{result.detail}</p>
        </StatePanel>
      )}

      <ProfilePrivacyCards />
    </div>
  );
}

function ConnectedProfile({
  endpoint,
  view,
}: {
  readonly endpoint: string;
  readonly view: IdentityProfileView;
}) {
  const content = view.profile?.content;
  const displayName =
    content === undefined || content.displayName.length === 0
      ? 'Unnamed member'
      : content.displayName;
  const publicPronouns = (content?.pronouns ?? []).filter((entry) => entry.visibility === 'public');

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={
          <StatusBadge tone={view.identity.active ? 'verified' : 'unavailable'}>
            {view.identity.active ? 'Active identity' : 'Deactivated identity'}
          </StatusBadge>
        }
        eyebrow="Portable profile"
        title={displayName}
      >
        <p className="profile-name-line">
          {view.handle === null ? (
            'No active .woke name'
          ) : (
            <code className="inline-identifier">{view.handle}.woke</code>
          )}
          {publicPronouns.length > 0
            ? ` · ${publicPronouns.map((entry) => entry.value).join(' · ')}`
            : null}
        </p>
      </AppPageHeader>

      <nav className="route-action-strip" aria-label="Profile sections">
        <Link href={`/profile/${encodeURIComponent(view.identity.identityId)}`}>Profile</Link>
        <Link href={`/profile/${encodeURIComponent(view.identity.identityId)}/edit`}>
          Edit readiness
        </Link>
      </nav>

      {view.identity.active ? null : (
        <StatePanel
          eyebrow="Retired identity"
          headingLevel={2}
          title="This identity was irreversibly deactivated."
          tone="degraded"
        >
          <p>
            {view.identity.deactivatedAt === undefined
              ? 'Historical public posts remain verifiable, but no new identity action can be authorized.'
              : `Deactivated ${formatUtcDate(view.identity.deactivatedAt)}. Historical public posts remain verifiable, but no new identity action can be authorized.`}{' '}
            A deactivated identity resolves no <code>.woke</code> name.
          </p>
        </StatePanel>
      )}

      <section className="profile-summary" aria-labelledby="profile-summary-title">
        <h2 id="profile-summary-title">Public profile</h2>
        {content === undefined ? (
          <p>
            No verified public profile manifest is projected for this identity. Nothing is
            fabricated in its place.
          </p>
        ) : (
          <>
            <p>{content.bio.length > 0 ? content.bio : 'No public bio is present.'}</p>
            {content.website === undefined && content.links.length === 0 ? null : (
              <ul className="profile-links">
                {content.website === undefined ? null : (
                  <li>
                    <a href={content.website} rel="noreferrer noopener">
                      {content.website}
                    </a>
                  </li>
                )}
                {content.links.map((link) => (
                  <li key={`${link.label}:${link.url}`}>
                    <a href={link.url} rel="noreferrer noopener">
                      {link.label}
                    </a>{' '}
                    <span className="profile-links__url">{link.url}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className="profile-summary__note">
          Only fields the author explicitly marked public are projected. Avatars and banners are
          verified references without connected gateway rendering, and relationships and posts are
          not part of this surface yet.
        </p>
      </section>

      <section className="profile-receipt" aria-labelledby="profile-receipt-title">
        <div>
          <p className="section-kicker">Identity receipt</p>
          <h2 id="profile-receipt-title">Independently checkable coordinates</h2>
        </div>
        <dl className="publication-evidence" aria-label="Identity projection receipt">
          <div className="publication-evidence__wide">
            <dt>Identity ID</dt>
            <dd>
              <code>{view.identity.identityId}</code>
            </dd>
          </div>
          <div className="publication-evidence__wide">
            <dt>Identity account</dt>
            <dd>
              <code>{view.identity.identityAddress}</code>
            </dd>
          </div>
          <div className="publication-evidence__wide">
            <dt>Current root authority</dt>
            <dd>
              <code>{view.identity.rootAuthority}</code>
            </dd>
          </div>
          <div>
            <dt>Identity sequence</dt>
            <dd>{view.identity.identitySequence}</dd>
          </div>
          <div>
            <dt>Updated slot</dt>
            <dd>{view.identity.updatedSlot}</dd>
          </div>
          {view.profile === null ? null : (
            <>
              <div className="publication-evidence__wide">
                <dt>Profile object ID</dt>
                <dd>
                  <code>{view.profile.objectId}</code>
                </dd>
              </div>
              <div className="publication-evidence__wide">
                <dt>Profile CID</dt>
                <dd>
                  <code>{view.profile.cid}</code>
                </dd>
              </div>
              <div>
                <dt>Profile updated</dt>
                <dd>{formatUtcDate(view.profile.updatedAt)}</dd>
              </div>
            </>
          )}
          <div>
            <dt>Checkpoint slot</dt>
            <dd>{view.meta.checkpointSlot ?? 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Projection</dt>
            <dd>{`${view.meta.source} · ${endpoint}`}</dd>
          </div>
        </dl>
        <p className="profile-receipt__note">
          This page is a noncanonical projection read. A displayed <code>.woke</code> name is the
          projection’s canonical active claim, never a native Solana address; destination proofs
          come from the strict name resolver before any signature.
        </p>
      </section>

      <ProfilePrivacyCards />
    </div>
  );
}

function ProfilePrivacyCards() {
  return (
    <section className="product-card-grid" aria-label="Profile privacy commitments">
      <InfoCard eyebrow="Names" title="Chosen and current" tone="plum">
        <p>
          Clients should protect current chosen names while representing historical state honestly.
        </p>
      </InfoCard>
      <InfoCard eyebrow="Disclosure" title="Each field has a boundary" tone="coral">
        <p>Languages, location, and optional profile details can be public, limited, or absent.</p>
      </InfoCard>
      <InfoCard eyebrow="Authority" title="Keys stay backstage" tone="sky">
        <p>Wallet and device identifiers prove control; they do not replace a human profile.</p>
      </InfoCard>
    </section>
  );
}

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
