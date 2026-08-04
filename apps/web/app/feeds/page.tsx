import type { Metadata } from 'next';

import { ShortFeed } from '@/components/short-feed';

export const metadata: Metadata = {
  title: 'Shorts',
  description: '18+ RedGIFs-class vertical shorts — synthetic fixtures until licensed media is online.',
};

export default function FeedsPage() {
  return (
    <div className="page-shell shorts-page">
      <ShortFeed />
    </div>
  );
}
