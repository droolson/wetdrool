import type { Metadata } from 'next';
import Link from 'next/link';

import { ProductState } from '@/components/product-state';

export const metadata: Metadata = {
  title: 'Notifications',
  description: 'A notification inbox awaiting authenticated relay and indexer providers.',
};

export default function NotificationsPage() {
  return (
    <ProductState
      cards={[
        {
          copy: 'Mentions, replies, follows, community changes, and system notices carry a typed category and source.',
          eyebrow: 'Signal',
          footer: 'No anonymous urgency',
          title: 'Know what asked for attention',
          tone: 'plum',
        },
        {
          copy: 'Mute categories, quiet hours, community notices, and push delivery independently without losing protocol history.',
          eyebrow: 'Control',
          footer: 'Device preferences stay local',
          title: 'Attention has boundaries',
          tone: 'coral',
        },
        {
          copy: 'Relay delivery is ephemeral convenience; durable public activity can be reconstructed from signed state.',
          eyebrow: 'Resilience',
          footer: 'Relay is replaceable',
          title: 'An inbox, not a source of truth',
          tone: 'sky',
        },
      ]}
      detail="No authenticated identity or notification relay is connected. The inbox will not fabricate mentions, follows, unread counts, or live delivery."
      eyebrow="Attention inbox"
      intro="Notifications should explain what happened, who can substantiate it, and which preference controls the interruption."
      stateEyebrow="Inbox unavailable"
      stateTitle="There is no notification session to read."
      title="Only the signals you invited."
    >
      <nav className="filter-strip" aria-label="Notification categories">
        <Link aria-current="page" href="/notifications">
          All
        </Link>
        <Link href="/notifications?filter=mentions">Mentions</Link>
        <Link href="/notifications?filter=communities">Communities</Link>
        <Link href="/notifications?filter=system">System</Link>
      </nav>
    </ProductState>
  );
}
