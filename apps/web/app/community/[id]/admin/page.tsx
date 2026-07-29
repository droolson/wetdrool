import type { Metadata } from 'next';

import { AuthoritySurface } from '@/components/authority-surface';
import { validateCommunityAddress } from '@/lib/community';

export const metadata: Metadata = {
  title: 'Community administration',
  description: 'Community administration boundaries without inferred moderator authority.',
};

export default async function CommunityAdminPage({ params }: { params: Promise<{ id: string }> }) {
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
          copy: 'Membership, role, and moderation actions cite the current grant that authorizes them.',
          eyebrow: 'Scope',
          title: 'Every control names a role',
          tone: 'plum',
        },
        {
          copy: 'High-impact changes show a readable diff, simulation, and explicit final confirmation.',
          eyebrow: 'Review',
          title: 'Inspect before signing',
          tone: 'coral',
        },
        {
          copy: 'Reports expose only the minimum encrypted evidence an authorized reviewer needs.',
          eyebrow: 'Evidence',
          title: 'Privacy survives moderation',
          tone: 'sky',
        },
      ]}
      detail={
        invalidAddress
          ? `${
              addressState.kind === 'invalid'
                ? addressState.detail
                : 'A community route requires one exact 32-byte base58 address.'
            } No provider request was sent and no administration capability was inferred.`
          : 'The interface cannot resolve this community, authenticate an operator, or prove a current scoped role. Every administration control therefore remains absent.'
      }
      eyebrow="Community administration"
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
              'Resolve the signed community manifest and current governance epoch.',
              'Authenticate a root or unexpired delegation for this exact community.',
              'Verify the required role and action scope before rendering controls.',
              'Simulate, summarize, sign, finalize, and re-read any resulting change.',
            ]
      }
      stateTitle={
        invalidAddress
          ? 'That is not a canonical Solana community address.'
          : 'No administration capability was granted.'
      }
      title="Stewardship needs visible authority."
    />
  );
}
