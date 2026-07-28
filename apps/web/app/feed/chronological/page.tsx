import type { Metadata } from 'next';

import { FeedSurface } from '@/components/feed-surface';

export const metadata: Metadata = {
  title: 'Chronological feed',
  description: 'A time-ordered feed awaiting its dedicated stable-cursor endpoint.',
};

export default function ChronologicalFeedPage() {
  return (
    <FeedSurface
      contract={[
        { label: 'Ordering', value: 'Finalized slot, transaction index, then stable object ID' },
        { label: 'Cursor', value: 'Opaque, immutable, and tied to one ordering recipe' },
        { label: 'Exclusions', value: 'Tombstones and viewer-local safety state' },
      ]}
      detail="Chronological means a documented total order, not whatever order one response happened to arrive in. Same-slot activity needs a deterministic tie-break."
      eyebrow="Chronological feed"
      principles={[
        {
          copy: 'Slot and transaction position define a replayable order across compliant indexers.',
          eyebrow: 'Determinism',
          title: 'Time with a tie-break',
          tone: 'plum',
        },
        {
          copy: 'Pagination never silently changes the ranking recipe between cursors.',
          eyebrow: 'Continuity',
          title: 'A cursor with one meaning',
          tone: 'coral',
        },
        {
          copy: 'Deleted and locally hidden content stays absent during rebuilds and refreshes.',
          eyebrow: 'Integrity',
          title: 'Suppression survives replay',
          tone: 'sky',
        },
      ]}
      title="Time order, clearly defined."
    />
  );
}
