import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, StatePanel, StatusBadge } from '@wokesocial/ui';

import { ComposerUnavailable } from '@/components/composer-unavailable';
import { FeedTabs, type FeedKind } from '@/components/feed-tabs';
import { FeedPostList } from '@/components/feed-post-list';
import { getHomeFeed } from '@/lib/indexer';
import { formatUtcDate } from '@/lib/presentation';

export const metadata: Metadata = {
  title: 'Home',
  description: 'A typed, honest feed view backed by the configured WokeSocial indexer.',
};

export const dynamic = 'force-dynamic';

const FEED_KINDS = new Set<FeedKind>(['home', 'following', 'chronological', 'community']);

function selectedFeed(value: string | string[] | undefined): FeedKind {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && FEED_KINDS.has(candidate as FeedKind) ? (candidate as FeedKind) : 'home';
}

function DegradedFeed({ detail, reason }: { detail: string; reason: string }) {
  const title =
    reason === 'unconfigured'
      ? 'Connect an indexer to begin.'
      : 'The feed is in a safe degraded state.';

  return (
    <StatePanel
      action={
        <ButtonLink href="/settings/providers" variant="secondary">
          Review provider setup
        </ButtonLink>
      }
      eyebrow="No live feed substituted"
      title={title}
      tone="degraded"
    >
      <p>{detail}</p>
    </StatePanel>
  );
}

function UnavailableFeed({ feed }: { feed: Exclude<FeedKind, 'home'> }) {
  const copy = {
    chronological:
      'The connected indexer exposes the compatible home contract, but not an independently paginated chronological endpoint.',
    community:
      'A verified community directory, membership projection, and community feed endpoint are not connected.',
    following:
      'A following feed requires an authenticated identity and relationship-aware endpoint that this web contract does not yet expose.',
  }[feed];

  return (
    <StatePanel
      action={
        <ButtonLink href="/home" variant="secondary">
          Return to the connected home feed
        </ButtonLink>
      }
      eyebrow={`${feed} feed unavailable`}
      title="No posts were borrowed from another feed."
      tone="empty"
    >
      <p>{copy}</p>
    </StatePanel>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ feed?: string | string[] }>;
}) {
  const activeFeed = selectedFeed((await searchParams).feed);
  const result = activeFeed === 'home' ? await getHomeFeed() : null;

  return (
    <div className="home-page page-shell">
      <header className="app-page-header">
        <div>
          <p className="section-kicker">Your network</p>
          <h1>Home, with the receipts.</h1>
        </div>
        <p>
          This foundation accepts only the typed indexer contract. It shows the indexer’s
          verification claims and proof metadata without inventing posts when the service is absent.
        </p>
      </header>

      <div className="home-layout">
        <div className="feed-column">
          <ComposerUnavailable />
          <FeedTabs active={activeFeed} />

          {result === null ? (
            <UnavailableFeed feed={activeFeed as Exclude<FeedKind, 'home'>} />
          ) : result.kind === 'degraded' ? (
            <DegradedFeed detail={result.detail} reason={result.reason} />
          ) : (
            <>
              <section className="indexer-receipt" aria-labelledby="indexer-receipt-title">
                <div>
                  <StatusBadge tone="verified">Typed response accepted</StatusBadge>
                  <h2 id="indexer-receipt-title">{result.value.meta.source}</h2>
                </div>
                <dl>
                  <div>
                    <dt>Endpoint</dt>
                    <dd>{result.endpoint}</dd>
                  </div>
                  <div>
                    <dt>Indexed</dt>
                    <dd>{formatUtcDate(result.value.meta.indexedAt)}</dd>
                  </div>
                  <div>
                    <dt>Checkpoint</dt>
                    <dd>
                      {result.value.meta.checkpointSlot === null
                        ? 'Not reported'
                        : `Slot ${result.value.meta.checkpointSlot.toLocaleString('en')}`}
                    </dd>
                  </div>
                </dl>
                <p>
                  “Verified” below is the indexer’s typed claim. Independent browser-side signature
                  verification remains disabled until the protocol SDK is wired and tested.
                </p>
              </section>

              {result.value.posts.length === 0 ? (
                <StatePanel
                  action={
                    <ButtonLink href="/protocol" variant="quiet">
                      Understand the publication path →
                    </ButtonLink>
                  }
                  eyebrow="Verified empty response"
                  title="The indexer has no posts for this feed."
                  tone="empty"
                >
                  <p>
                    The service responded successfully with an empty list. No sample content is
                    inserted to make the network look active.
                  </p>
                </StatePanel>
              ) : (
                <section className="feed-list" aria-labelledby="feed-title">
                  <div className="feed-list__heading">
                    <h2 id="feed-title">Latest from the configured indexer</h2>
                    <span>{result.value.posts.length} returned</span>
                  </div>
                  <FeedPostList posts={result.value.posts} />
                </section>
              )}
            </>
          )}
        </div>

        <aside className="home-sidebar" aria-label="Home feed information">
          <section>
            <p className="section-kicker">Feed recipe</p>
            <h2>Chronological foundation</h2>
            <p>
              The first connected view requests the compatible home endpoint. Recommendation
              controls arrive only with a deterministic scoring implementation and explanations.
            </p>
          </section>
          <section>
            <p className="section-kicker">Publishing</p>
            <h2>Intentionally locked</h2>
            <p>
              A real post needs canonical serialization, signing, storage, WokeNet confirmation, and
              indexing. The UI will not skip those steps for appearances.
            </p>
          </section>
          <section className="sidebar-links">
            <h2>Inspect the foundation</h2>
            <Link href="/protocol">Protocol boundaries</Link>
            <Link href="/safety">Safety authority</Link>
            <Link href="/settings/providers">Provider configuration</Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
