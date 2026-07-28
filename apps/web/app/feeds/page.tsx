import type { Metadata } from 'next';
import { ButtonLink, InfoCard, StatusBadge } from '@socially-woke/ui';

import { AppPageHeader } from '@/components/app-page-header';

export const metadata: Metadata = {
  title: 'Feed directory',
  description: 'Choose between connected and planned Socially Woke feed recipes.',
};

const FEEDS = [
  {
    copy: 'The only feed currently connected to the typed production web contract.',
    href: '/home',
    status: 'Connected when configured',
    title: 'Home',
    tone: 'plum' as const,
  },
  {
    copy: 'Posts from a verified active relationship graph for the signed-in viewer.',
    href: '/feed/following',
    status: 'Identity endpoint required',
    title: 'Following',
    tone: 'coral' as const,
  },
  {
    copy: 'A strict slot-and-position ordering with a stable, replayable cursor.',
    href: '/feed/chronological',
    status: 'Dedicated endpoint required',
    title: 'Chronological',
    tone: 'sky' as const,
  },
  {
    copy: 'Windowed public momentum with published scoring and anti-manipulation rules.',
    href: '/feed/trending',
    status: 'Feed provider required',
    title: 'Trending',
    tone: 'neutral' as const,
  },
  {
    copy: 'Accessible, verified image and video objects behind viewer playback controls.',
    href: '/feed/media',
    status: 'Gateway and manifest support required',
    title: 'Media',
    tone: 'plum' as const,
  },
] as const;

export default function FeedsPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">One connected contract</StatusBadge>}
        eyebrow="Feed directory"
        title="Choose the recipe, not just the app."
      >
        <p>
          Each feed is a distinct contract with its own source, ordering, cursor, filters, and
          explanation. A route is never marked connected merely because another feed works.
        </p>
      </AppPageHeader>

      <section className="feed-directory" aria-label="Available feed routes">
        {FEEDS.map((feed) => (
          <InfoCard
            eyebrow={feed.status}
            footer={
              <ButtonLink href={feed.href} variant="quiet">
                Inspect {feed.title.toLocaleLowerCase('en')} →
              </ButtonLink>
            }
            key={feed.title}
            title={feed.title}
            tone={feed.tone}
          >
            <p>{feed.copy}</p>
          </InfoCard>
        ))}
      </section>
    </div>
  );
}
