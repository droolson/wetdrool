import type { Metadata } from 'next';

import { AuthoritySurface } from '@/components/authority-surface';

export const metadata: Metadata = {
  title: 'Creator monetization',
  description: 'Creator monetization boundaries without simulated payments or entitlements.',
};

export default async function CreatorMonetizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AuthoritySurface
      backHref={`/creator/${encodeURIComponent(id)}`}
      backLabel="Back to creator"
      cards={[
        {
          copy: 'The network does not require a speculative platform token. Compatible payment rails remain optional.',
          eyebrow: 'Currency',
          title: 'No platform token',
          tone: 'plum',
        },
        {
          copy: 'Price, operator, taxes, fees, renewal, refund, and delivery terms appear before authorization.',
          eyebrow: 'Checkout',
          title: 'Terms before signature',
          tone: 'coral',
        },
        {
          copy: 'An entitlement is a signed receipt with scope and expiry, not a decorative success screen.',
          eyebrow: 'Receipt',
          title: 'Access can be verified',
          tone: 'sky',
        },
      ]}
      detail="No creator authority, offering object, payment provider, wallet authorization, settlement receipt, or entitlement verifier is configured. Every payment action remains unavailable."
      eyebrow="Creator monetization"
      identifier={id}
      requirements={[
        'Resolve the creator identity and verify authority for the exact offering.',
        'Display complete price, operator, fee, renewal, delivery, and refund terms.',
        'Request explicit payment authorization through a configured compatible rail.',
        'Verify settlement and issue a scoped entitlement receipt before showing success.',
      ]}
      stateTitle="No payment or entitlement was attempted."
      title="Earn without pretending money moved."
    />
  );
}
