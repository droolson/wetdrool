import type { Metadata } from 'next';

import { Marketplace } from '@/components/marketplace';

export const metadata: Metadata = {
  title: 'Market',
  description: 'E2EE content marketplace with Solana x402 Payment Required unlocks.',
};

export default function MarketPage() {
  return (
    <div className="page-shell market-page">
      <Marketplace />
    </div>
  );
}
