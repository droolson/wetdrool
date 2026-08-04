import type { Metadata } from 'next';

import { CreatorStudio } from '@/components/creator-studio';

export const metadata: Metadata = {
  title: 'Creator',
  description: 'Decentralized creator studio — subscriptions, PPV, tips, E2EE delivery staged honestly.',
};

export default async function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="page-shell creator-page">
      <CreatorStudio handle={id.slice(0, 96)} />
    </div>
  );
}
