import type { Metadata } from 'next';

import { VanityRegistry } from '@/components/vanity-registry';

export const metadata: Metadata = {
  title: 'Vanity · .drool',
  description:
    'Honest vanity /.drool surface: registry not live, claim not executable, no invented owned names. Pricing is product intent only.',
};

export default function VanityPage() {
  return <VanityRegistry />;
}
