import type { Metadata } from 'next';

import { TokenEconomy } from '@/components/token-economy';

export const metadata: Metadata = {
  title: 'Economy · $DROOL pending',
  description:
    'Honest economy surface: points ledger, Pro quote, $DROOL mint-pending until a verified mint is configured. No invented CA or earnings claims.',
};

export default function TokenPage() {
  return <TokenEconomy />;
}
