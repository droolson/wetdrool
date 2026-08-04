import Link from 'next/link';
import { StatusBadge } from '@wetdrool/ui';

import type {
  CommunitySearchMatch,
  DirectVerifiedCommunity,
  PublicVerifiedCommunity,
} from '@/lib/community';
import { abbreviate, formatUtcDate } from '@/lib/presentation';

const membershipLabels = {
  invite: 'Invite only',
  open: 'Open membership',
  request: 'Request to join',
} as const;

const matchLabels: Record<CommunitySearchMatch, string> = {
  'community-description': 'Manifest description',
  'community-name': 'Community name',
  'community-slug': 'Community slug',
};

export interface CommunityCardProps {
  community: DirectVerifiedCommunity | PublicVerifiedCommunity;
  matchedBy?: CommunitySearchMatch;
}

export function CommunityCard({ community, matchedBy }: CommunityCardProps) {
  const content = community.content;
  const governanceUpdated =
    community.governanceVersion !== community.manifestGovernanceVersion ||
    community.governanceStrategyHash !== community.manifestGovernanceStrategyHash;

  return (
    <article className="community-card">
      <header>
        <span className="community-card__mark" aria-hidden="true">
          {content.name.slice(0, 1).toLocaleUpperCase()}
        </span>
        <div>
          <div className="community-card__badges">
            <StatusBadge tone="verified">Verified manifest</StatusBadge>
            <span>{content.visibility === 'public' ? 'Public' : 'Unlisted'}</span>
            {governanceUpdated ? <span>Governance anchor updated</span> : null}
            {matchedBy === undefined ? null : <span>{matchLabels[matchedBy]}</span>}
          </div>
          <h3>{content.name}</h3>
          <p className="community-card__slug">c/{content.slug}</p>
        </div>
      </header>

      <p className="community-card__description">
        {content.description.trim().length > 0
          ? content.description
          : 'This verified manifest does not include a public description.'}
      </p>

      <dl className="community-card__facts">
        <div>
          <dt>Membership</dt>
          <dd>{membershipLabels[content.membershipPolicy]}</dd>
        </div>
        <div>
          <dt>Manifest governance</dt>
          <dd>One active member, one vote</dd>
        </div>
        <div>
          <dt>Federation</dt>
          <dd>{content.federationPolicy.mode.replaceAll('-', ' ')}</dd>
        </div>
      </dl>

      <footer>
        <span>
          Anchored <time dateTime={community.createdAt}>{formatUtcDate(community.createdAt)}</time>
        </span>
        <Link
          href={`/community/${encodeURIComponent(community.communityAddress)}`}
          title={`Open ${content.name} at ${community.communityAddress}`}
        >
          Open verified community
          <span aria-hidden="true"> ↗</span>
        </Link>
      </footer>

      <p className="community-card__address" title={community.communityAddress}>
        Solana address <code>{abbreviate(community.communityAddress, 8)}</code>
      </p>
    </article>
  );
}
