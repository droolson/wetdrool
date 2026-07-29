import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, StatePanel, StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { ProjectedFeedView } from '@/components/projected-feed-view';
import {
  getProjectedFeed,
  type ProjectedFeedResult,
  validateFeedCursor,
} from '@/lib/projected-feed';

export const metadata: Metadata = {
  title: 'Chronological feed',
  description:
    'Verified public WokeSocial posts in deterministic finalized-event order with recipe-bound pagination.',
};

export const dynamic = 'force-dynamic';

function statusFor(
  result: ProjectedFeedResult | null,
  cursorState: ReturnType<typeof validateFeedCursor>,
) {
  if (cursorState.kind === 'invalid') {
    return <StatusBadge tone="degraded">Invalid cursor rejected</StatusBadge>;
  }
  return result?.kind === 'ready' ? (
    <StatusBadge tone="verified">Live typed projection</StatusBadge>
  ) : (
    <StatusBadge tone="degraded">Feed safely degraded</StatusBadge>
  );
}

export default async function ChronologicalFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string | string[] }>;
}) {
  const cursorState = validateFeedCursor((await searchParams).before);
  const result =
    cursorState.kind === 'invalid'
      ? null
      : await getProjectedFeed({
          mode: 'chronological',
          ...(cursorState.kind === 'valid' ? { cursor: cursorState.cursor } : {}),
        });

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={statusFor(result, cursorState)}
        eyebrow="Chronological feed"
        title="Time order, with a verifiable recipe."
      >
        <p>
          This route reads verified public posts from your configured open indexer. It orders by
          finalized event time and a stable object-ID tie-break—not by an author-controlled
          timestamp or engagement score.
        </p>
      </AppPageHeader>

      <nav className="feed-family-nav" aria-label="Feed directory">
        <Link href="/home">Home</Link>
        <Link href="/feed/following">Following preview</Link>
        <Link aria-current="page" href="/feed/chronological">
          Chronological
        </Link>
        <Link href="/feed/trending">Trending</Link>
        <Link href="/feed/media">Media</Link>
        <Link href="/feeds">All feeds</Link>
      </nav>

      <section className="feed-contract" aria-labelledby="chronological-contract-title">
        <div>
          <p className="section-kicker">Published response contract</p>
          <h2 id="chronological-contract-title">One deterministic meaning per cursor.</h2>
        </div>
        <dl>
          <div>
            <dt>Ordering</dt>
            <dd>Finalized event time descending, then stable object ID descending.</dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>Verified public, non-tombstoned posts from one WokeNet deployment on Solana.</dd>
          </div>
          <div>
            <dt>Cursor</dt>
            <dd>Opaque, bounded, and cryptographically bound to network and feed recipe.</dd>
          </div>
        </dl>
      </section>

      {cursorState.kind === 'invalid' ? (
        <StatePanel
          action={
            <ButtonLink href="/feed/chronological" variant="secondary">
              Return to the newest page
            </ButtonLink>
          }
          eyebrow="Cursor not sent"
          title="That feed page reference is not valid."
          tone="degraded"
        >
          <p>{cursorState.detail} No request was sent to the configured indexer.</p>
        </StatePanel>
      ) : result === null ? null : (
        <ProjectedFeedView
          baseHref="/feed/chronological"
          continuation={cursorState.kind === 'valid'}
          mode="chronological"
          result={result}
        />
      )}
    </div>
  );
}
