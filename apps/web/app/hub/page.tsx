import type { Metadata } from 'next';

import { HubCatalog } from '@/components/hub-catalog';

export const metadata: Metadata = {
  title: 'Hub',
  description: 'Decentralized adult catalog — tube-style browse over portable manifests.',
};

export default function HubPage() {
  return (
    <div className="page-shell hub-page">
      <HubCatalog />
    </div>
  );
}
