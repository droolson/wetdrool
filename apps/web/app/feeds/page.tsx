import type { Metadata } from 'next';
import { ButtonLink, InfoCard, StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from '@/components/app-page-header';

export const metadata: Metadata = {
  title: 'Feed directory',
  description: 'Choose between connected and planned WokeSocial feed recipes.',
};

const FEEDS = [
  {
    copy: 'A compact verified-post contract for the configured network’s newest public activity.',
    href: '/home',
    status: 'Connected when configured',
    title: 'Home',
    tone: 'plum' as const,
  },
  {
    copy: 'A clearly labeled public preview of posts selected by one verified follow graph.',
    href: '/feed/following',
    status: 'Public preview connected',
    title: 'Following preview',
    tone: 'coral' as const,
  },
  {
    copy: 'Finalized event-time ordering with a stable, recipe-bound opaque cursor.',
    href: '/feed/chronological',
    status: 'Connected when configured',
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
        actions={<StatusBadge tone="verified">Three typed feed routes</StatusBadge>}
        eyebrow="Feed directory"
        title="Choose the recipe, not just the app."
      >
        <p>
          Each feed is a distinct contract with its own source, ordering, cursor, filters, and
          explanation. Following remains a public graph preview until passkey sessions can prove a
          WokeNet identity binding.
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
