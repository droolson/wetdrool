import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { CommunityCard } from '@/components/community-card';
import {
  getCommunityDirectory,
  validateCommunityCursor,
  type CommunityDirectoryResult,
} from '@/lib/community';
import { formatUtcDate } from '@/lib/presentation';

export const metadata: Metadata = {
  title: 'Communities',
  description: 'Discover verified public WetDrool communities anchored to Solana.',
};

export const dynamic = 'force-dynamic';

function directoryStatus(result: CommunityDirectoryResult | null, invalidCursor: boolean) {
  if (invalidCursor) {
    return <StatusBadge tone="degraded">Invalid page rejected</StatusBadge>;
  }
  if (result?.kind === 'ready') {
    return <StatusBadge tone="verified">Verified public directory</StatusBadge>;
  }
  return <StatusBadge tone="degraded">Directory safely degraded</StatusBadge>;
}

export default async function CommunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string | string[] }>;
}) {
  const cursorState = validateCommunityCursor((await searchParams).before);
  const result =
    cursorState.kind === 'invalid'
      ? null
      : await getCommunityDirectory({
          ...(cursorState.kind === 'valid' ? { cursor: cursorState.cursor } : {}),
        });

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={directoryStatus(result, cursorState.kind === 'invalid')}
        eyebrow="Community commons"
        title="Find a space with rules you can verify."
      >
        <p>
          This public directory accepts only schema-v2 community manifests whose content hash,
          creator signature, Solana address, and DroolNet anchor agree. Unlisted and private spaces
          are never placed in discovery.
        </p>
      </AppPageHeader>

      <nav className="route-action-strip" aria-label="Community discovery">
        <Link aria-current="page" href="/communities">
          Public directory
        </Link>
        <Link href="/search">Search communities</Link>
        <Link href="/settings/providers">Projection provider</Link>
      </nav>

      {cursorState.kind === 'invalid' ? (
        <StatePanel
          action={
            <ButtonLink href="/communities" variant="secondary">
              Return to the first page
            </ButtonLink>
          }
          eyebrow="Request not sent"
          title="That community page reference is not valid."
          tone="degraded"
        >
          <p>
            {cursorState.detail} No request was sent to the configured indexer, and no partial
            cursor was used.
          </p>
        </StatePanel>
      ) : result?.kind === 'degraded' ? (
        <StatePanel
          action={
            <ButtonLink href="/settings/providers" variant="secondary">
              Review providers
            </ButtonLink>
          }
          eyebrow="No directory data accepted"
          title={
            result.reason === 'unconfigured'
              ? 'Connect an indexer and DroolNet network scope.'
              : 'The community directory is safely degraded.'
          }
          tone="degraded"
        >
          <p>{result.detail}</p>
        </StatePanel>
      ) : result?.kind === 'ready' && result.value.communities.length === 0 ? (
        <StatePanel
          action={
            cursorState.kind === 'valid' ? (
              <ButtonLink href="/communities" variant="secondary">
                Return to the first page
              </ButtonLink>
            ) : undefined
          }
          eyebrow="Accepted empty response"
          title="No verified public communities are present on this page."
          tone="empty"
        >
          <p>
            The provider responded at checkpoint{' '}
            {result.value.meta.checkpointSlot === null
              ? 'not reported'
              : result.value.meta.checkpointSlot.toLocaleString('en')}
            . No unverified, unlisted, private, or sponsored spaces were inserted.
          </p>
        </StatePanel>
      ) : result?.kind === 'ready' ? (
        <section className="community-directory" aria-labelledby="community-directory-title">
          <header>
            <div>
              <p className="section-kicker">Replaceable public projection</p>
              <h2 id="community-directory-title">
                {result.value.communities.length} verified{' '}
                {result.value.communities.length === 1 ? 'community' : 'communities'}
              </h2>
            </div>
            <dl>
              <div>
                <dt>Provider</dt>
                <dd>{result.endpoint}</dd>
              </div>
              <div>
                <dt>Checkpoint</dt>
                <dd>
                  {result.value.meta.checkpointSlot === null
                    ? 'Not reported'
                    : `Slot ${result.value.meta.checkpointSlot.toLocaleString('en')}`}
                </dd>
              </div>
              <div>
                <dt>Indexed</dt>
                <dd>
                  <time dateTime={result.value.meta.indexedAt}>
                    {formatUtcDate(result.value.meta.indexedAt)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Recipe</dt>
                <dd>{result.value.recipe}</dd>
              </div>
            </dl>
          </header>

          <ul className="community-directory__grid">
            {result.value.communities.map((community) => (
              <li key={community.communityAddress}>
                <CommunityCard community={community} />
              </li>
            ))}
          </ul>

          <nav className="community-directory__pagination" aria-label="Community directory pages">
            {cursorState.kind === 'valid' ? (
              <Link href="/communities">First page</Link>
            ) : (
              <span>First page</span>
            )}
            {result.value.nextCursor === null ? (
              <span>No later verified page</span>
            ) : (
              <Link
                href={`/communities?before=${encodeURIComponent(result.value.nextCursor)}`}
                rel="next"
              >
                Next verified page
              </Link>
            )}
          </nav>
        </section>
      ) : null}

      <section className="product-card-grid" aria-label="Community directory commitments">
        <InfoCard eyebrow="Privacy" title="Discovery is public-only" tone="plum">
          <p>
            Unlisted spaces require their exact Solana address. Private and restricted manifests are
            not rendered, even if a provider sends them.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Governance" title="One active member, one vote" tone="coral">
          <p>
            Every accepted v2 manifest binds the exact DroolNet governance strategy instead of
            advertising unsupported voting models.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Proof" title="Manifest and anchor agree" tone="sky">
          <p>
            The portable object ID must bind to the anchored manifest hash, creator identity, and
            deployment-scoped signing key.
          </p>
        </InfoCard>
      </section>
    </div>
  );
}
