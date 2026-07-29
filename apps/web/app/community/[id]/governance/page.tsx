import type { Metadata } from 'next';

import { AuthoritySurface } from '@/components/authority-surface';
import { validateCommunityAddress } from '@/lib/community';

export const metadata: Metadata = {
  title: 'Community governance',
  description: 'Community governance readiness without fabricated proposals or votes.',
};

export default async function CommunityGovernancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const addressState = validateCommunityAddress(id);
  const invalidAddress = addressState.kind !== 'valid';
  return (
    <AuthoritySurface
      backHref={
        invalidAddress ? '/communities' : `/community/${encodeURIComponent(addressState.address)}`
      }
      backLabel={invalidAddress ? 'Back to communities' : 'Back to community'}
      cards={[
        {
          copy: 'Quorum, threshold, eligibility, delegation, and voting window are fixed before voting begins.',
          eyebrow: 'Rules',
          title: 'The process precedes the outcome',
          tone: 'plum',
        },
        {
          copy: 'A proposal carries a canonical diff or content-addressed action plan that clients can inspect.',
          eyebrow: 'Proposal',
          title: 'Vote on exact changes',
          tone: 'coral',
        },
        {
          copy: 'Final results retain participation privacy where the governance mode permits it.',
          eyebrow: 'Record',
          title: 'Verifiable without overexposure',
          tone: 'sky',
        },
      ]}
      detail={
        invalidAddress
          ? `${
              addressState.kind === 'invalid'
                ? addressState.detail
                : 'A community route requires one exact 32-byte base58 address.'
            } No provider request was sent and no proposal or voter state was inferred.`
          : 'No verified governance manifest, eligible voter set, proposal projection, or signed viewer identity is available. Sample motions and vote totals would be misleading.'
      }
      eyebrow="Community governance"
      identifier={
        addressState.kind === 'valid'
          ? addressState.address
          : addressState.address || 'No valid address'
      }
      requirements={
        invalidAddress
          ? [
              'Require one canonical 32-byte base58 Solana community address before resolving any state.',
              'Never interpret a slug or display name as a community route identifier.',
            ]
          : [
              'Resolve the active governance mode, rules, quorum, and proposal authority.',
              'Verify each proposal object and its exact execution payload.',
              'Determine viewer eligibility at the declared snapshot.',
              'Submit and finalize a signed vote without exposing private evidence.',
            ]
      }
      stateTitle={
        invalidAddress
          ? 'That is not a canonical Solana community address.'
          : 'There are no verified proposals to display.'
      }
      title="Shared power, exact rules."
    />
  );
}
