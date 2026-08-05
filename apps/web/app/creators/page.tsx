import type { Metadata } from 'next';

import { CreatorsDirectory } from '@/components/creators-directory';

export const metadata: Metadata = {
  title: 'Creators',
  description:
    'Synthetic creator directory — founder preview and short-feed fixtures. Checkout staged.',
};

export default function CreatorsPage() {
  return (
    <div className="page-shell creators-page">
      <CreatorsDirectory />
    </div>
  );
}
