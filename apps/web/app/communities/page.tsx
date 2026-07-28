import type { Metadata } from 'next';

import { ProductState } from '@/components/product-state';

export const metadata: Metadata = {
  title: 'Communities',
  description: 'Community discovery awaiting a verified community projection.',
};

export default function CommunitiesPage() {
  return (
    <ProductState
      cards={[
        {
          copy: 'Public, private, and secret spaces declare their visibility and joining rules in a signed community manifest.',
          eyebrow: 'Membership',
          footer: 'No inferred access',
          title: 'A door with a label',
          tone: 'plum',
        },
        {
          copy: 'Moderators, role grants, appeals, and federation policy identify the authority and scope behind each action.',
          eyebrow: 'Governance',
          footer: 'Roles are auditable',
          title: 'Power that names itself',
          tone: 'coral',
        },
        {
          copy: 'Communities can choose their own norms while members retain personal blocks, mutes, content warnings, and client filters.',
          eyebrow: 'Safety',
          footer: 'Layers remain distinct',
          title: 'Local rules, personal agency',
          tone: 'sky',
        },
      ]}
      detail="The current web/indexer contract does not expose a verified community directory. No sample memberships, member totals, or moderator activity are substituted."
      eyebrow="Community commons"
      intro="Communities are portable social spaces with explicit membership, roles, rules, governance, and federation boundaries."
      stateEyebrow="Directory unavailable"
      stateTitle="No community projection is connected."
      title="Gather around something real."
    />
  );
}
