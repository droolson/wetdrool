import type { Metadata } from 'next';

import { FeedSurface } from '@/components/feed-surface';

export const metadata: Metadata = {
  title: 'Media feed',
  description: 'An accessible media feed awaiting verified manifest and gateway support.',
};

export default function MediaFeedPage() {
  return (
    <FeedSurface
      contract={[
        { label: 'Manifest', value: 'Signed content hash, media type, dimensions, and duration' },
        { label: 'Accessibility', value: 'Alt text, captions, transcript, and content warning' },
        { label: 'Retrieval', value: 'Hash-checked gateway with bounded resource policy' },
      ]}
      detail="A media-first view needs more than thumbnails. Each item must carry accessible metadata, a verified content reference, and playback consent."
      eyebrow="Media feed"
      principles={[
        {
          copy: 'Missing alt text, captions, or transcripts remains visible instead of being silently ignored.',
          eyebrow: 'Access',
          title: 'Metadata is part of the post',
          tone: 'plum',
        },
        {
          copy: 'Motion, sound, data use, and sensitive material begin behind viewer-controlled defaults.',
          eyebrow: 'Consent',
          title: 'Playback is a choice',
          tone: 'coral',
        },
        {
          copy: 'Every retrieved byte is bounded and checked against its signed reference before display.',
          eyebrow: 'Integrity',
          title: 'Gateways do not define truth',
          tone: 'sky',
        },
      ]}
      title="See more. Assume less."
    />
  );
}
