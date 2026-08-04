import type { Metadata } from 'next';

import { LiveRooms } from '@/components/live-rooms';

export const metadata: Metadata = {
  title: 'Live',
  description: '18+ livestream rooms — Twitch energy, staged media until SFU + tips rails ship.',
};

export default function LivePage() {
  return (
    <div className="page-shell live-page">
      <LiveRooms />
    </div>
  );
}
