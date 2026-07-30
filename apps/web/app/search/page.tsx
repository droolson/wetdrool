import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { CommunityCard } from '@/components/community-card';
import { PostCard } from '@/components/post-card';
import {
  searchPublic,
  type PublicSearchQueryState,
  type SearchItem,
  type SearchResult,
  validatePublicSearchQuery,
} from '@/lib/indexer';
import { abbreviate, formatUtcDate } from '@/lib/presentation';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search a typed, replaceable WokeNet public projection.',
};

export const dynamic = 'force-dynamic';

function statusFor(result: SearchResult | null, queryState: PublicSearchQueryState) {
  if (queryState.kind === 'empty') {
    return <StatusBadge tone="neutral">Awaiting a public query</StatusBadge>;
  }
  if (queryState.kind === 'invalid') {
    return <StatusBadge tone="degraded">Invalid query rejected</StatusBadge>;
  }
  if (result?.kind === 'ready') {
    return <StatusBadge tone="verified">Typed search response accepted</StatusBadge>;
  }
  return <StatusBadge tone="degraded">Search safely degraded</StatusBadge>;
}

function matchLabel(result: SearchItem): string {
  const labels = {
    'community-description': 'Community manifest description',
    'community-name': 'Community name',
    'community-slug': 'Community slug',
    'display-name': 'Current display name',
    'exact-identifier': 'Exact public identifier',
    handle: 'Active handle',
    'post-body': 'Verified public post',
    'profile-bio': 'Current public bio',
  } as const;
  return labels[result.matchedBy];
}

function SearchResultCard({ result }: { result: SearchItem }) {
  if (result.kind === 'post') {
    return <PostCard post={result.post} />;
  }
  if (result.kind === 'community') {
    return <CommunityCard community={result.community} matchedBy={result.matchedBy} />;
  }

  return (
    <article className="search-result-card">
      <div>
        <StatusBadge tone="neutral">{matchLabel(result)}</StatusBadge>
        <h3>{result.displayName}</h3>
        <p className="search-result-card__handle">
          {result.handle === null ? 'No active .woke name' : `${result.handle}.woke`}
        </p>
      </div>
      {result.bio ? <p>{result.bio}</p> : <p>No public bio is present in this projection.</p>}
      <footer>
        <time dateTime={result.updatedAt}>Updated {formatUtcDate(result.updatedAt)}</time>
        <Link href={`/profile/${encodeURIComponent(result.identityId)}`}>Open profile</Link>
      </footer>
    </article>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const rawQuery = (await searchParams).q;
  const queryState = validatePublicSearchQuery(rawQuery);
  const query = queryState.kind === 'valid' ? queryState.query : '';
  const inputValue =
    queryState.kind === 'valid' ||
    (queryState.kind === 'invalid' && queryState.reason === 'too-short')
      ? queryState.query
      : '';
  const result = queryState.kind === 'valid' ? await searchPublic(query) : null;

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={statusFor(result, queryState)}
        eyebrow="Portable discovery"
        title="Search public network state."
      >
        <p>
          The configured indexer can search current public profiles, verified posts, and schema-v2
          public communities. It is replaceable, and its result order is never canonical.
        </p>
      </AppPageHeader>

      <form action="/search" className="search-bar" method="get" role="search">
        <label htmlFor="network-search">Search public posts, people, or communities</label>
        <div>
          <input
            autoComplete="off"
            defaultValue={inputValue}
            id="network-search"
            name="q"
            placeholder="Try a name, phrase, handle, or public identifier"
            required
            type="search"
          />
          <button type="submit">Search the public index</button>
        </div>
        <p>
          Queries must normalize to 3–120 Unicode code points. A valid query is sent to your
          configured indexer and remains in the address bar. Do not enter private or sensitive
          information.
        </p>
      </form>

      {queryState.kind === 'empty' ? (
        <StatePanel
          action={
            <ButtonLink href="/settings/providers" variant="secondary">
              Review providers
            </ButtonLink>
          }
          eyebrow="No query sent"
          title="Enter a public term to search."
          tone="empty"
        >
          <p>No sample accounts or posts are substituted before a provider responds.</p>
        </StatePanel>
      ) : queryState.kind === 'invalid' ? (
        <StatePanel eyebrow="Invalid query not sent" title={queryState.detail} tone="degraded">
          <p>
            The supplied URL query was rejected in full and was not truncated or transmitted to an
            indexer.
          </p>
        </StatePanel>
      ) : result?.kind === 'degraded' ? (
        <StatePanel
          action={
            <ButtonLink href="/settings/providers" variant="secondary">
              Review providers
            </ButtonLink>
          }
          eyebrow="No search data accepted"
          title={
            result.reason === 'unconfigured'
              ? 'Connect an indexer to search.'
              : 'The search provider is safely degraded.'
          }
          tone="degraded"
        >
          <p>{result.detail}</p>
        </StatePanel>
      ) : result?.kind === 'ready' && result.value.results.length === 0 ? (
        <StatePanel
          eyebrow="Accepted empty response"
          title={`The provider returned no matches for “${query}”.`}
          tone="empty"
        >
          <p>
            The configured indexer responded successfully at checkpoint{' '}
            {result.value.meta.checkpointSlot === null
              ? 'not reported'
              : result.value.meta.checkpointSlot.toLocaleString('en')}
            . No nearby or sponsored results were inserted.
          </p>
        </StatePanel>
      ) : result?.kind === 'ready' ? (
        <section className="search-results" aria-labelledby="search-results-title">
          <header>
            <div>
              <p className="section-kicker">Replaceable projection</p>
              <h2 id="search-results-title">
                {result.value.results.length} public{' '}
                {result.value.results.length === 1 ? 'result' : 'results'} for “{query}”
              </h2>
            </div>
            <dl>
              <div>
                <dt>Provider</dt>
                <dd>{result.endpoint}</dd>
              </div>
              <div>
                <dt>Checkpoint</dt>
                <dd>
                  {result.value.meta.checkpointSlot === null
                    ? 'Not reported'
                    : `Slot ${result.value.meta.checkpointSlot.toLocaleString('en')}`}
                </dd>
              </div>
              <div>
                <dt>WokeNet deployment</dt>
                <dd title={result.value.network}>
                  <code>{abbreviate(result.value.network, 8)}</code>
                </dd>
              </div>
              <div>
                <dt>Ranking</dt>
                <dd>{result.value.ranking.version}</dd>
              </div>
            </dl>
          </header>
          <ol>
            {result.value.results.map((item) => (
              <li
                key={
                  item.kind === 'post'
                    ? `post:${item.post.id}`
                    : item.kind === 'community'
                      ? `community:${item.community.communityAddress}`
                      : `person:${item.identityId}`
                }
              >
                <SearchResultCard result={item} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

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
        <InfoCard eyebrow="Policy" title="Deterministic ranking" tone="coral">
          <p>
            Exact identifiers and handles rank before current public text, then recency breaks ties.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Portability" title="Replace the index" tone="sky">
          <p>A client can change providers without changing the identity or public source data.</p>
        </InfoCard>
      </section>
    </div>
  );
}
