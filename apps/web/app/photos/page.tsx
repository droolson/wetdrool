import type { Metadata } from 'next';
import { ButtonLink, SectionHeading, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { PhotosGallery } from '@/components/photos-gallery';

export const metadata: Metadata = {
  title: 'Photos',
  description: 'Share photos on WetDrool with NSFW labels, filters, and creator tools.',
};

export default function PhotosPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={
          <>
            <StatusBadge tone="pending">licensedMedia: false</StatusBadge>
            <StatusBadge tone="pending">Media pipeline</StatusBadge>
          </>
        }
        eyebrow="Photo sharing"
        title="Shoot. Label. Drip."
      >
        <p>
          Photo posts with NSFW/SFW labels, kink tags, alt text, and content warnings. Media bytes
          stay off-chain; DroolNet anchors hashes when verification matters. Product API fixtures
          are synthetic abstract only.
        </p>
        <ButtonLink href="/compose">Upload photos</ButtonLink>
      </AppPageHeader>

      <PhotosGallery />

      <section>
        <SectionHeading
          eyebrow="Pipeline"
          title="What happens on upload"
          description={
            <ol>
              <li>Client-side age + consent prompts for NSFW packs</li>
              <li>Malware scan (ClamAV path in media-worker)</li>
              <li>AI moderation triage (CSAM hash, hate, NCII signals)</li>
              <li>Encode variants + signed media manifest</li>
              <li>Feed projection with mode-aware ranking</li>
            </ol>
          }
        />
      </section>
    </div>
  );
}
