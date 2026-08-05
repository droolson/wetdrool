import type { Metadata } from 'next';
import { ButtonLink, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { ProductPhotos } from '@/components/product-photos';

export const metadata: Metadata = {
  title: 'Photos',
  description:
    'Honest photo gallery via product API — synthetic abstract fixtures only until licensed media and media-worker upload wire.',
};

export default function PhotosPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Photos via product API</StatusBadge>}
        eyebrow="Photo sharing"
        title="Shoot. Label. Drip."
      >
        <p>
          Photo posts with NSFW/SFW labels, kink tags, alt text, and content warnings. Media bytes
          stay off-chain; DroolNet anchors hashes when verification matters. Rows appear only after a
          successful <code>/api/v1/photos</code> response — never as silent local re-fanout. HTTP
          errors (including 404) fail closed to empty.
        </p>
        <ButtonLink href="/compose">Upload photos</ButtonLink>
      </AppPageHeader>

      <section className="photo-gallery" aria-labelledby="photo-gallery-title">
        <div>
          <p className="section-kicker">Gallery</p>
          <h2 id="photo-gallery-title">Abstract fixtures until media is verified.</h2>
        </div>
        <ProductPhotos />
      </section>
    </div>
  );
}
