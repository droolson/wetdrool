import type { Metadata } from 'next';
import { StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { ProductSearch } from '@/components/product-search';

export const metadata: Metadata = {
  title: 'Search',
  description:
    'Honest product search — empty until a global index is configured; optional synthetic catalog hits only.',
};

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const raw = (await searchParams).q;
  const initialQuery = Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Product search API</StatusBadge>}
        eyebrow="Portable discovery"
        title="Search without inventing an index."
      >
        <p>
          GET <code>/api/v1/search</code> never fabricates network-wide posts or users. When a query
          matches in-repo fixtures, hits are returned only as explicitly labeled{' '}
          <code>synthetic-catalog</code> results. Otherwise the list stays empty and{' '}
          <code>configured: false</code>.
        </p>
      </AppPageHeader>
      <ProductSearch initialQuery={initialQuery} />
    </div>
  );
}
