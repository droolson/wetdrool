import type { Metadata } from 'next';
import { StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { ProductStories } from '@/components/product-stories';

export const metadata: Metadata = {
  title: 'Stories',
  description:
    'Honest stories rail via product API — synthetic ephemeral fixtures only; never invents view counts or network-wide deletion.',
};

export default function StoriesPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Stories via product API</StatusBadge>}
        eyebrow="Stories"
        title="A moment with clear edges."
      >
        <p>
          Stories should feel immediate without making false deletion promises. Signed audience,
          expiry, accessibility, and storage policy stay visible. Rows appear only after a successful{' '}
          <code>/api/v1/stories</code> response — never as silent local re-fanout. HTTP errors
          (including 404) fail closed to empty.
        </p>
      </AppPageHeader>

      <section className="stories-rail" aria-labelledby="stories-rail-title">
        <div>
          <p className="section-kicker">Short-lived media</p>
          <h2 id="stories-rail-title">Expiry without erasure theater.</h2>
        </div>
        <ProductStories />
      </section>
    </div>
  );
}
