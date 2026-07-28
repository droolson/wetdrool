import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@socially-woke/ui';

import { AppPageHeader } from '@/components/app-page-header';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Prepare a network search without substituting fabricated results.',
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const rawQuery = (await searchParams).q;
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery)?.trim().slice(0, 120) ?? '';

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="degraded">Search provider unavailable</StatusBadge>}
        eyebrow="Portable discovery"
        title="Search without surrendering context."
      >
        <p>
          A compatible service can index public protocol data, publish its policy, and be replaced.
          This interface does not claim results before that service exists.
        </p>
      </AppPageHeader>

      <form action="/search" className="search-bar" method="get" role="search">
        <label htmlFor="network-search">Search public posts, people, or communities</label>
        <div>
          <input
            autoComplete="off"
            defaultValue={query}
            id="network-search"
            maxLength={120}
            name="q"
            placeholder="Try a name, phrase, or community"
            type="search"
          />
          <button type="submit">Check search readiness</button>
        </div>
        <p>Queries are shown in the address bar. Do not enter private or sensitive information.</p>
      </form>

      <StatePanel
        action={
          <ButtonLink href="/settings/providers" variant="secondary">
            Review providers
          </ButtonLink>
        }
        eyebrow={query ? 'Query not sent' : 'Awaiting a query'}
        title={query ? `No provider received “${query}”.` : 'Search is ready for a real endpoint.'}
        tone="empty"
      >
        <p>
          {query
            ? 'The interface retained the query locally in this URL, but did not transmit it or invent matching accounts and posts.'
            : 'Enter a public term to exercise this local interface. Results remain unavailable until a typed search contract is integrated.'}
        </p>
      </StatePanel>

      <nav className="discovery-directory" aria-label="Browse without search">
        <p>Browse a known surface instead</p>
        <div>
          <Link href="/feeds">Feed directory</Link>
          <Link href="/stories">Stories</Link>
          <Link href="/video">Video</Link>
          <Link href="/events">Events</Link>
          <Link href="/communities">Communities</Link>
          <Link href="/developers">Developer surface</Link>
        </div>
      </nav>

      <section className="product-card-grid" aria-label="Search commitments">
        <InfoCard eyebrow="Scope" title="Public objects only" tone="plum">
          <p>
            Private messages, recovery data, and nonpublic profile fields never belong in search.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Policy" title="Operator rules disclosed" tone="coral">
          <p>Each search service should publish indexing, removal, ranking, and retention rules.</p>
        </InfoCard>
        <InfoCard eyebrow="Portability" title="Replace the index" tone="sky">
          <p>A client can change providers without changing the identity or public source data.</p>
        </InfoCard>
      </section>
    </div>
  );
}
