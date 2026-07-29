import Link from 'next/link';

export type FeedKind = 'chronological' | 'community' | 'following' | 'home';

const FEEDS: readonly { href: string; id: FeedKind; label: string }[] = [
  { href: '/home', id: 'home', label: 'Home' },
  { href: '/feed/following', id: 'following', label: 'Following' },
  { href: '/feed/chronological', id: 'chronological', label: 'Chronological' },
  { href: '/home?feed=community', id: 'community', label: 'Community' },
];

export function FeedTabs({ active }: { active: FeedKind }) {
  return (
    <nav className="feed-tabs" aria-label="Feed views">
      <ul>
        {FEEDS.map((feed) => (
          <li key={feed.id}>
            <Link aria-current={feed.id === active ? 'page' : undefined} href={feed.href}>
              {feed.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
