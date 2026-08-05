import type { Metadata } from 'next';

import { MediaSurface } from '@/components/media-surface';

export const metadata: Metadata = {
  title: 'Video',
  description: 'A consent-forward video surface awaiting verified media providers.',
};

export default function VideoPage() {
  return (
    <>
      <MediaSurface
        cards={[
          {
            copy: 'Playback begins only after a verified manifest and viewer preferences permit motion and sound.',
            eyebrow: 'Consent',
            title: 'Still first, motion second',
            tone: 'plum',
          },
          {
            copy: 'Captions, transcript, language, duration, aspect ratio, and content warnings arrive before playback.',
            eyebrow: 'Context',
            title: 'Know the shape before loading',
            tone: 'coral',
          },
          {
            copy: 'Adaptive delivery may use replaceable providers while the signed content hash remains authoritative.',
            eyebrow: 'Portability',
            title: 'Delivery is not ownership',
            tone: 'sky',
          },
        ]}
        detail="Video delivery can be fast and replaceable while the signed media object, accessibility metadata, and viewer consent remain authoritative. Founder drop: CUMDUMP · HAIL SATAN · EVIL at /video/cumdump."
        eyebrow="Video"
        format="Long and short form"
        title="Motion on your terms."
      />
    </>
  );
}
