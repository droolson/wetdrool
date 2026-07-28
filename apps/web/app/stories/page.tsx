import type { Metadata } from 'next';

import { MediaSurface } from '@/components/media-surface';

export const metadata: Metadata = {
  title: 'Stories',
  description: 'An ephemeral media surface awaiting signed expiry and verified retrieval support.',
};

export default function StoriesPage() {
  return (
    <MediaSurface
      cards={[
        {
          copy: 'Expiry is signed metadata and a client-display promise, not a claim that public bytes can be erased everywhere.',
          eyebrow: 'Expiry',
          title: 'Temporary, honestly described',
          tone: 'plum',
        },
        {
          copy: 'Audience and reply permissions travel with each story object and are checked before delivery.',
          eyebrow: 'Audience',
          title: 'A smaller room by design',
          tone: 'coral',
        },
        {
          copy: 'Alt text, captions, content warnings, and tap-to-pause controls are part of the format.',
          eyebrow: 'Access',
          title: 'Fast does not mean inaccessible',
          tone: 'sky',
        },
      ]}
      detail="Stories should feel immediate without making false deletion promises. Signed audience, expiry, accessibility, and storage policy stay visible."
      eyebrow="Stories"
      format="Short-lived media"
      title="A moment with clear edges."
    />
  );
}
