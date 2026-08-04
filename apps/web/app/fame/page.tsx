import type { Metadata } from 'next';

import { HallOfFameBoard } from '@/components/hall-of-fame-board';

export const metadata: Metadata = {
  title: 'Hall of Fame',
  description: 'Points leaderboard and grind loop — climb with check-ins and shorts.',
};

export default function FamePage() {
  return (
    <div className="page-shell fame-page">
      <HallOfFameBoard />
    </div>
  );
}
