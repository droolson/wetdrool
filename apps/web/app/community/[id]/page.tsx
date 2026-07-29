import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from '@/components/app-page-header';
import {
  getCommunityDetail,
  validateCommunityAddress,
  type CommunityDetailResult,
  type DirectVerifiedCommunity,
} from '@/lib/community';
import { abbreviate, formatUtcDate } from '@/lib/presentation';

export const metadata: Metadata = {
  title: 'Community',
  description: 'Inspect a verified WokeSocial community by its Solana address.',
};

export const dynamic = 'force-dynamic';

const membershipLabels = {
  invite: 'Invite only',
  open: 'Open membership',
  request: 'Request to join',
} as const;

function percent(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString('en', { maximumFractionDigits: 2 })}%`;
}

function detailStatus(result: CommunityDetailResult | null, invalidAddress: boolean) {
  if (invalidAddress) return <StatusBadge tone="degraded">Invalid address rejected</StatusBadge>;
  if (result?.kind === 'ready') {
    return (
      <StatusBadge tone="verified">
        Verified {result.value.community.content.visibility} manifest
      </StatusBadge>
    );
  }
  if (result?.kind === 'not-found') {
    return <StatusBadge tone="neutral">No public detail</StatusBadge>;
  }
  return <StatusBadge tone="degraded">Community safely degraded</StatusBadge>;
}

function CommunityOverview({
  community,
  result,
}: {
  community: DirectVerifiedCommunity;
  result: Extract<CommunityDetailResult, { kind: 'ready' }>;
}) {
  const content = community.content;
  const governance = content.governance;
  const governanceUpdated =
    community.governanceVersion !== community.manifestGovernanceVersion ||
    community.governanceStrategyHash !== community.manifestGovernanceStrategyHash;

  return (
    <>
      {content.visibility === 'unlisted' ? (
        <aside className="community-privacy-notice" aria-label="Unlisted community notice">
          <StatusBadge tone="neutral">Direct address only</StatusBadge>
          <p>
            This manifest is unlisted. It is intentionally absent from the public directory and
            search, and this page does not expose membership records.
          </p>
        </aside>
      ) : null}

      <section className="community-overview" aria-labelledby="community-about-title">
        <div>
          <p className="section-kicker">c/{content.slug}</p>
          <h2 id="community-about-title">About this space</h2>
          <p className="community-overview__description">
            {content.description.trim().length > 0
              ? content.description
              : 'This verified manifest does not include a public description.'}
          </p>
        </div>
        <dl className="community-overview__facts">
          <div>
            <dt>Visibility</dt>
            <dd>{content.visibility}</dd>
          </div>
          <div>
            <dt>Membership</dt>
            <dd>{membershipLabels[content.membershipPolicy]}</dd>
          </div>
          <div>
            <dt>Federation</dt>
            <dd>{content.federationPolicy.mode.replaceAll('-', ' ')}</dd>
          </div>
          <div>
            <dt>Manifest revision</dt>
            <dd>{content.replacement.sequence.toLocaleString('en')}</dd>
          </div>
        </dl>
      </section>

      <section className="community-governance" aria-labelledby="community-governance-title">
        <div>
          <p className="section-kicker">Bound governance</p>
          <h2 id="community-governance-title">One active member, one vote.</h2>
          <p>
            The accepted v2 manifest commits to one exact WokeNet strategy. This view does not infer
            token weights, delegated voting, moderator overrides, or executable proposal effects.
          </p>
        </div>
        <dl>
          <div>
            <dt>Model</dt>
            <dd>{governance.model.replaceAll('-', ' ')}</dd>
          </div>
          <div>
            <dt>Quorum</dt>
            <dd>{percent(governance.quorumBasisPoints)}</dd>
          </div>
          <div>
            <dt>Approval</dt>
            <dd>{percent(governance.approvalBasisPoints)}</dd>
          </div>
          <div>
            <dt>Abstentions</dt>
            <dd>{governance.abstainTreatment.replaceAll('-', ' ')}</dd>
          </div>
          <div>
            <dt>Execution</dt>
            <dd>{governance.execution.replaceAll('-', ' ')}</dd>
          </div>
          <div>
            <dt>Strategy version</dt>
            <dd>{governance.version}</dd>
          </div>
        </dl>
      </section>

      <aside className="community-governance-state" aria-label="Current governance anchor">
        <StatusBadge tone={governanceUpdated ? 'pending' : 'verified'}>
          {governanceUpdated ? 'Current anchor differs' : 'Creation anchor current'}
        </StatusBadge>
        <p>
          {governanceUpdated
            ? `The current on-chain governance commitment is version ${community.governanceVersion}, while this verified creation manifest binds version ${community.manifestGovernanceVersion}. Both commitments are shown below; the creation manifest is not rewritten by the later update.`
            : `The current on-chain governance commitment still matches creation-manifest version ${community.manifestGovernanceVersion}.`}
        </p>
      </aside>

      <section className="community-policy-grid" aria-label="Community policy references">
        <article>
          <p className="section-kicker">Rules</p>
          <h2>Portable policy references</h2>
          <dl>
            <div>
              <dt>Community rules</dt>
              <dd title={content.governanceRuleSet?.id}>
                {content.governanceRuleSet === undefined
                  ? 'No separate rule set declared'
                  : abbreviate(content.governanceRuleSet.id)}
              </dd>
            </div>
            <div>
              <dt>Moderation rules</dt>
              <dd title={content.moderationRuleSet?.id}>
                {content.moderationRuleSet === undefined
                  ? 'No separate rule set declared'
                  : abbreviate(content.moderationRuleSet.id)}
              </dd>
            </div>
          </dl>
        </article>
        <article>
          <p className="section-kicker">Federation</p>
          <h2>Declared boundaries</h2>
          <dl>
            <div>
              <dt>Allowed peers</dt>
              <dd>{content.federationPolicy.allow.length.toLocaleString('en')}</dd>
            </div>
            <div>
              <dt>Blocked peers</dt>
              <dd>{content.federationPolicy.block.length.toLocaleString('en')}</dd>
            </div>
            <div>
              <dt>Policy document</dt>
              <dd>
                {content.federationPolicy.policyDocument === undefined
                  ? 'Not separately referenced'
                  : abbreviate(content.federationPolicy.policyDocument.cid)}
              </dd>
            </div>
          </dl>
        </article>
        <article>
          <p className="section-kicker">Treasury</p>
          <h2>No implied custody</h2>
          {content.treasury === undefined ? (
            <p>No treasury is declared by this manifest.</p>
          ) : (
            <dl>
              <div>
                <dt>Account</dt>
                <dd title={content.treasury.account}>
                  <code>{abbreviate(content.treasury.account)}</code>
                </dd>
              </div>
              <div>
                <dt>Allowed assets</dt>
                <dd>{content.treasury.assetAllowList.length.toLocaleString('en')}</dd>
              </div>
            </dl>
          )}
        </article>
      </section>

      <details className="community-proof">
        <summary>Verification and Solana anchor details</summary>
        <dl>
          <div>
            <dt>Community address</dt>
            <dd>
              <code>{community.communityAddress}</code>
            </dd>
          </div>
          <div>
            <dt>WokeNet deployment</dt>
            <dd>
              <code>{community.networkId}</code>
            </dd>
          </div>
          <div>
            <dt>Portable object</dt>
            <dd>
              <code>{community.objectId}</code>
            </dd>
          </div>
          <div>
            <dt>Manifest CID</dt>
            <dd>
              <code>{community.manifestCid}</code>
            </dd>
          </div>
          <div>
            <dt>Manifest hash</dt>
            <dd>
              <code>{community.manifestHash}</code>
            </dd>
          </div>
          <div>
            <dt>Creator identity</dt>
            <dd>
              <code>{community.creatorIdentityId}</code>
            </dd>
          </div>
          <div>
            <dt>Signing key</dt>
            <dd>
              <code>{community.signingKeyId}</code>
            </dd>
          </div>
          <div>
            <dt>Creation authority</dt>
            <dd>
              <code>{community.manifestAuthority}</code>
            </dd>
          </div>
          <div>
            <dt>Latest community action signer</dt>
            <dd>
              <code>{community.latestActionAuthority}</code>
            </dd>
          </div>
          <div>
            <dt>Manifest created</dt>
            <dd>
              <time dateTime={community.manifestCreatedAt}>
                {formatUtcDate(community.manifestCreatedAt)}
              </time>
            </dd>
          </div>
          <div>
            <dt>Solana anchor</dt>
            <dd>Slot {BigInt(community.createdSlot).toLocaleString('en')}</dd>
          </div>
          <div>
            <dt>Latest projection</dt>
            <dd>
              Slot {BigInt(community.updatedSlot).toLocaleString('en')} ·{' '}
              <time dateTime={community.updatedAt}>{formatUtcDate(community.updatedAt)}</time>
            </dd>
          </div>
          <div>
            <dt>Manifest governance commitment</dt>
            <dd>
              v{community.manifestGovernanceVersion} ·{' '}
              <code>{community.manifestGovernanceStrategyHash}</code>
            </dd>
          </div>
          <div>
            <dt>Current governance commitment</dt>
            <dd>
              v{community.governanceVersion} · <code>{community.governanceStrategyHash}</code>
            </dd>
          </div>
          <div>
            <dt>Provider checkpoint</dt>
            <dd>
              {result.value.meta.checkpointSlot === null
                ? 'Not reported'
                : `Slot ${result.value.meta.checkpointSlot.toLocaleString('en')}`}
            </dd>
          </div>
        </dl>
        <p>
          Accepted from {result.endpoint}. The index is replaceable; the portable manifest and its
          WokeNet Solana commitments are the verification boundary.
        </p>
      </details>

      <section className="product-card-grid" aria-label="Community access boundaries">
        <InfoCard eyebrow="Membership" title="No roster exposed" tone="plum">
          <p>
            This public response contains policy metadata only. Member identities, roles, and
            private participation are intentionally absent.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Actions" title="Joining is not wired yet" tone="coral">
          <p>
            The page does not claim a membership mutation until wallet identity, signed object
            publication, and finalized confirmation are connected.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Portability" title="The address is the route" tone="sky">
          <p>
            Slugs remain human-readable manifest metadata. Solana community addresses—not mutable
            names—identify routes and provider queries.
          </p>
        </InfoCard>
      </section>
    </>
  );
}

export default async function CommunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const addressState = validateCommunityAddress(id);
  const result =
    addressState.kind === 'valid' ? await getCommunityDetail(addressState.address) : null;
  const community = result?.kind === 'ready' ? result.value.community : null;
  const displayAddress =
    addressState.kind === 'valid'
      ? abbreviate(addressState.address, 12)
      : addressState.address || 'No valid address';

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={detailStatus(result, addressState.kind !== 'valid')}
        eyebrow="Community"
        title={community?.content.name ?? 'A space must prove its rules.'}
      >
        <p>
          {community === null ? 'Requested address' : 'Verified Solana address'}:{' '}
          <code className="inline-identifier">{displayAddress}</code>
        </p>
      </AppPageHeader>

      <nav className="route-action-strip" aria-label="Community sections">
        <Link
          aria-current="page"
          href={
            addressState.kind === 'valid'
              ? `/community/${encodeURIComponent(addressState.address)}`
              : '/communities'
          }
        >
          Overview
        </Link>
        {addressState.kind === 'valid' ? (
          <>
            <Link href={`/community/${encodeURIComponent(addressState.address)}/governance`}>
              Governance
            </Link>
            <Link href={`/community/${encodeURIComponent(addressState.address)}/admin`}>
              Administration
            </Link>
          </>
        ) : null}
        <Link href="/communities">Public directory</Link>
      </nav>

      {addressState.kind !== 'valid' ? (
        <StatePanel
          action={
            <ButtonLink href="/communities" variant="secondary">
              Back to communities
            </ButtonLink>
          }
          eyebrow="Request not sent"
          title="That is not a canonical Solana community address."
          tone="degraded"
        >
          <p>
            {addressState.kind === 'invalid'
              ? addressState.detail
              : 'A community route requires one exact 32-byte base58 address.'}{' '}
            Slugs and display names are not accepted as route identifiers.
          </p>
        </StatePanel>
      ) : result?.kind === 'not-found' ? (
        <StatePanel
          action={
            <ButtonLink href="/communities" variant="secondary">
              Back to communities
            </ButtonLink>
          }
          eyebrow="No renderable manifest"
          title="No public community detail was found for this address."
          tone="empty"
        >
          <p>
            The address may be absent, unverified, private, or restricted. Those cases intentionally
            share this response so the page does not disclose protected community state.
          </p>
        </StatePanel>
      ) : result?.kind === 'degraded' ? (
        <StatePanel
          action={
            <ButtonLink href="/settings/providers" variant="secondary">
              Review providers
            </ButtonLink>
          }
          eyebrow="No community data accepted"
          title={
            result.reason === 'unconfigured'
              ? 'Connect an indexer and WokeNet network scope.'
              : 'The community provider is safely degraded.'
          }
          tone="degraded"
        >
          <p>{result.detail}</p>
        </StatePanel>
      ) : result?.kind === 'ready' ? (
        <CommunityOverview community={result.value.community} result={result} />
      ) : null}
    </div>
  );
}
